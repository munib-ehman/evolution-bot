/**
 * The free store-audit engine — shared by the /api/audit edge function and
 * the dev-server middleware in dev-api.ts (files starting with "_" in api/
 * are helpers; Vercel does not expose them as endpoints).
 *
 * Pipeline: normalize URL → fetch homepage + /products.json (public data
 * only) → deterministic rule checks → score → one non-streaming Groq call to
 * write the prose (template fallback so the audit never depends on the LLM)
 * → best-effort persist to Supabase via the service role.
 *
 * Deliberately dependency-free: all HTML "parsing" is regex/substring
 * scanning, which is all these checks need.
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT } from "./_shared";
import { getConnection, shopifyGet, type ShopifyConnection } from "./_shopify";

/** Per-request fetch timeout (homepage and products.json run in parallel). */
export const AUDIT_FETCH_TIMEOUT_MS = 8_000;
/** Cap on bytes read from any storefront response. */
export const AUDIT_MAX_BYTES = 1_500_000;
/** How many findings the funnel page shows before the sign-up blur. */
export const AUDIT_FREE_FINDINGS = 3;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Types

export interface AuditFinding {
  id: string;
  title: string;
  /** 1–5; drives ranking and the score deduction. */
  impact: number;
  detail: string;
  /** Concrete examples (product titles etc.) backing the finding. */
  evidence?: string[];
}

/** 30-day trading stats — only present on a connected (OAuth) deep audit. */
export interface AuditStats {
  currency: string | null;
  orders30: number;
  revenue30: number;
  aov: number | null;
  repeatRate: number | null;
  abandoned30: number;
  abandonedValue30: number;
}

export interface AuditReport {
  storeUrl: string;
  platform: "shopify" | "unknown";
  score: number;
  summary: string;
  productCount: number | null;
  findings: AuditFinding[];
  /** True when the report includes authenticated (OAuth) store data. */
  connected?: boolean;
  stats?: AuditStats;
}

interface ShopifyVariant {
  available?: boolean;
}
interface ShopifyProduct {
  title?: string;
  handle?: string;
  body_html?: string | null;
  images?: unknown[];
  variants?: ShopifyVariant[];
}

export interface AuditEnv {
  groqKey?: string;
  groqModel?: string;
  /** Web-search-capable model for research skills (GROQ_RESEARCH_MODEL). */
  groqResearchModel?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

// ---------------------------------------------------------------------------
// URL normalization + SSRF guard

/**
 * Turn whatever the owner pasted into a safe https origin, or explain why we
 * won't fetch it. The endpoint is unauthenticated, so this is the SSRF gate:
 * https only, default port, no credentials, no IPs or internal hostnames.
 */
export function normalizeStoreUrl(raw: unknown): { url: string; host: string } | { error: string } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { error: "Enter your store URL." };
  if (trimmed.length > 300) return { error: "That URL is too long." };

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.username || parsed.password) return { error: "URLs with credentials aren't allowed." };
  if (parsed.port && parsed.port !== "443") return { error: "Only standard https URLs are supported." };
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.includes(":") || // IPv6
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) // IPv4 literal
  ) {
    return { error: "Enter your store's public web address (like mystore.com)." };
  }

  return { url: `https://${host}`, host };
}

// ---------------------------------------------------------------------------
// Storefront fetching

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= AUDIT_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

async function fetchText(url: string): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(AUDIT_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { text: await readCapped(res), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

export interface StoreSnapshot {
  html: string;
  /** Homepage + a real product page: where apps actually inject scripts. */
  corpus: string;
  products: ShopifyProduct[] | null;
  passwordProtected: boolean;
  isShopify: boolean;
  /** Shopify policy pages that resolved (null = not checked / not Shopify). */
  policies: { refund: boolean; shipping: boolean } | null;
}

/**
 * Fetch the store's public surface in two waves: homepage + /products.json
 * first, then (informed by those) a real product page — most apps only
 * inject scripts there, not on the homepage — and the Shopify policy pages.
 */
export async function fetchStore(host: string): Promise<StoreSnapshot> {
  const [homepage, productsRaw] = await Promise.all([
    fetchText(`https://${host}/`),
    fetchText(`https://${host}/products.json?limit=250`),
  ]);

  const html = homepage?.text ?? "";
  let products: ShopifyProduct[] | null = null;
  if (productsRaw) {
    try {
      const parsed = JSON.parse(productsRaw.text) as { products?: unknown };
      if (Array.isArray(parsed.products)) products = parsed.products as ShopifyProduct[];
    } catch {
      /* not JSON — not a Shopify products endpoint */
    }
  }

  const passwordProtected =
    (homepage?.finalUrl ?? "").includes("/password") ||
    /template-password|password-page|id="password"/i.test(html);

  const isShopify =
    products !== null || /cdn\.shopify\.com|Shopify\.theme|\/cdn\/shop\//i.test(html);

  // Wave 2 — only when wave 1 found a live store.
  let productHtml = "";
  let policies: StoreSnapshot["policies"] = null;
  if (!passwordProtected && (html || products)) {
    const firstHandle = products?.find((p) => typeof p.handle === "string")?.handle;
    const [productPage, refund, shipping] = await Promise.all([
      firstHandle ? fetchText(`https://${host}/products/${firstHandle}`) : Promise.resolve(null),
      isShopify ? fetchText(`https://${host}/policies/refund-policy`) : Promise.resolve(null),
      isShopify ? fetchText(`https://${host}/policies/shipping-policy`) : Promise.resolve(null),
    ]);
    productHtml = productPage?.text ?? "";
    if (isShopify) {
      // Shopify serves a real page only when the policy exists; a missing one
      // redirects home or 404s. ~200 chars of body text = "actually written".
      const looksReal = (p: { text: string; finalUrl: string } | null, slug: string) =>
        Boolean(p && p.finalUrl.includes(slug) && stripHtml(p.text).length > 200);
      policies = {
        refund: looksReal(refund, "refund-policy"),
        shipping: looksReal(shipping, "shipping-policy"),
      };
    }
  }

  return { html, corpus: html + "\n" + productHtml, products, passwordProtected, isShopify, policies };
}

// ---------------------------------------------------------------------------
// Rule checks

const APP_PATTERNS = {
  reviews: /judge\.me|judgeme|loox|yotpo|stamped\.io|okendo|junip|reviews\.io|trustpilot/i,
  emailCapture: /klaviyo|omnisend|privy|postscript|attentive|mailchimp|sendlane|drip\.com/i,
  upsell: /rebuy|zipify|aftersell|boldapps|candyrack|selleasy|upcart|honeycombupsell/i,
  support: /gorgias|tidio|zendesk|intercom|crisp\.chat|chatra|reamaze|tawk\.to|richpanel/i,
  pixel: /fbevents\.js|connect\.facebook\.net|gtag\/js|googletagmanager|analytics\.tiktok|snap\.licdn|pintrk/i,
};

export function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html: string, pattern: RegExp): string {
  const tag = html.match(pattern)?.[0] ?? "";
  return tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
}

/** Deterministic findings, ranked by impact. The LLM only rewrites prose. */
export function runChecks(snapshot: StoreSnapshot): AuditFinding[] {
  const { html, corpus, products, policies } = snapshot;
  const findings: AuditFinding[] = [];

  if (!APP_PATTERNS.emailCapture.test(corpus)) {
    findings.push({
      id: "no-cart-recovery",
      title: "No cart-recovery or email capture detected",
      impact: 5,
      detail:
        "We found no email/SMS marketing app (Klaviyo, Omnisend, Privy, Postscript…) on your storefront. Roughly 7 in 10 carts are abandoned — without recovery emails those sales are simply lost.",
    });
  }

  if (!APP_PATTERNS.reviews.test(corpus)) {
    findings.push({
      id: "no-reviews",
      title: "No customer reviews shown",
      impact: 4,
      detail:
        "We couldn't detect a reviews app (Judge.me, Loox, Yotpo…). Social proof is one of the highest-leverage conversion levers — stores without visible reviews convert significantly worse.",
    });
  }

  if (!APP_PATTERNS.upsell.test(corpus)) {
    findings.push({
      id: "no-upsells",
      title: "No upsell or cross-sell in the purchase flow",
      impact: 4,
      detail:
        "No upsell/cross-sell app detected. Post-purchase and in-cart offers are the cheapest way to raise average order value — you're leaving revenue on every order.",
    });
  }

  if (!APP_PATTERNS.support.test(corpus)) {
    findings.push({
      id: "no-support-channel",
      title: "No live support channel on the storefront",
      impact: 3,
      detail:
        "No chat widget or helpdesk detected (Gorgias, Tidio, Zendesk…). Pre-sale questions that can't be asked are sales that quietly walk away — especially on mobile.",
    });
  }

  if (!APP_PATTERNS.pixel.test(corpus)) {
    findings.push({
      id: "no-marketing-pixel",
      title: "No marketing or analytics pixel detected",
      impact: 3,
      detail:
        "We found no Meta pixel, Google tag, or TikTok pixel. Without one you can't retarget visitors or measure which traffic actually buys — every ad dollar flies blind.",
    });
  }

  if (policies && (!policies.refund || !policies.shipping)) {
    const missing = [
      !policies.refund ? "refund policy" : null,
      !policies.shipping ? "shipping policy" : null,
    ].filter(Boolean);
    findings.push({
      id: "missing-policies",
      title: `Missing ${missing.join(" and ")}`,
      impact: 2,
      detail:
        "Shoppers check policies before trusting a store with their card — and payment processors and ad platforms look for them too. Publishing them is a 20-minute trust win.",
    });
  }

  if (products && products.length > 0) {
    const thin = products.filter((p) => stripHtml(p.body_html).length < 200);
    if (thin.length > 0) {
      findings.push({
        id: "thin-descriptions",
        title: `Thin product descriptions on ${thin.length} of ${products.length} products`,
        impact: 4,
        detail:
          "These product pages have under ~200 characters of description — not enough to sell the product or rank in search. Every thin page is a landing page that can't close.",
        evidence: thin.slice(0, 3).map((p) => p.title ?? "(untitled)"),
      });
    }

    const soldOut = products.filter(
      (p) => (p.variants?.length ?? 0) > 0 && p.variants!.every((v) => v.available === false),
    );
    if (soldOut.length > 0) {
      findings.push({
        id: "sold-out-dead-ends",
        title: `${soldOut.length} sold-out product${soldOut.length > 1 ? "s" : ""} with no back-in-stock capture`,
        impact: 3,
        detail:
          "Sold-out product pages are dead ends: shoppers land, see 'sold out', and leave forever. A 'notify me when it's back' form turns that demand into a launch list.",
        evidence: soldOut.slice(0, 3).map((p) => p.title ?? "(untitled)"),
      });
    }

    const noImages = products.filter((p) => (p.images?.length ?? 0) === 0);
    if (noImages.length > 0) {
      findings.push({
        id: "missing-images",
        title: `${noImages.length} product${noImages.length > 1 ? "s" : ""} without photos`,
        impact: 3,
        detail: "Products without a single image almost never sell online.",
        evidence: noImages.slice(0, 3).map((p) => p.title ?? "(untitled)"),
      });
    }
  }

  if (html) {
    const description = metaContent(html, /<meta[^>]+name=["']description["'][^>]*>/i);
    const ogImage = metaContent(html, /<meta[^>]+property=["']og:image["'][^>]*>/i);
    const seoProblems: string[] = [];
    if (description.length < 50) seoProblems.push("missing or very short meta description");
    if (!ogImage) seoProblems.push("no social-sharing image (og:image)");
    if (seoProblems.length > 0) {
      findings.push({
        id: "weak-seo",
        title: "Homepage SEO & social previews need work",
        impact: 2,
        detail: `Your homepage has ${seoProblems.join(" and ")}. This hurts both search ranking and how your links look when shared.`,
      });
    }
  }

  return findings.sort((a, b) => b.impact - a.impact);
}

/** 100 minus a weight per finding, floored — an honest but motivating number. */
export function scoreAudit(findings: AuditFinding[]): number {
  const deduction = findings.reduce((n, f) => n + f.impact * 6, 0);
  return Math.max(25, Math.min(95, 100 - deduction));
}

// ---------------------------------------------------------------------------
// Deep checks (Shopify OAuth) — real trading data, quantified findings

interface ShopifyOrder {
  total_price?: string;
  created_at?: string;
  customer?: { id?: number } | null;
}
interface ShopifyCheckout {
  total_price?: string;
}

/**
 * Order-level trading stats for an arbitrary window — shared by the deep
 * audit (30 days) and the skill engine (up to 90 days). `fetched` is false
 * when the orders API was unreachable (stats are then all zeros).
 */
export interface OrderStats {
  currency: string | null;
  days: number;
  fetched: boolean;
  orders: number;
  revenue: number;
  aov: number | null;
  uniqueCustomers: number;
  repeatRate: number | null;
  weekly: { weekStart: string; orders: number; revenue: number }[];
}

export async function fetchOrderStats(conn: ShopifyConnection, days: number): Promise<OrderStats> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent(since);
  const [shopInfo, ordersRes] = await Promise.all([
    shopifyGet<{ shop?: { currency?: string } }>(conn.shop_domain, conn.access_token, "shop.json"),
    shopifyGet<{ orders?: ShopifyOrder[] }>(
      conn.shop_domain,
      conn.access_token,
      `orders.json?status=any&limit=250&created_at_min=${q}&fields=id,total_price,created_at,customer`,
    ),
  ]);

  const currency = shopInfo?.shop?.currency ?? null;
  const orders = ordersRes?.orders ?? [];
  const revenue = orders.reduce((n, o) => n + (parseFloat(o.total_price ?? "0") || 0), 0);
  const aov = orders.length > 0 ? revenue / orders.length : null;

  const byCustomer = new Map<number, number>();
  for (const o of orders) {
    const id = o.customer?.id;
    if (typeof id === "number") byCustomer.set(id, (byCustomer.get(id) ?? 0) + 1);
  }
  const repeatRate =
    byCustomer.size > 0
      ? [...byCustomer.values()].filter((c) => c > 1).length / byCustomer.size
      : null;

  const byWeek = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const t = Date.parse(o.created_at ?? "");
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // snap to Sunday
    const key = d.toISOString().slice(0, 10);
    const bucket = byWeek.get(key) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += parseFloat(o.total_price ?? "0") || 0;
    byWeek.set(key, bucket);
  }
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, w]) => ({ weekStart, orders: w.orders, revenue: Math.round(w.revenue) }));

  return {
    currency,
    days,
    fetched: ordersRes !== null,
    orders: orders.length,
    revenue,
    aov,
    uniqueCustomers: byCustomer.size,
    repeatRate,
    weekly,
  };
}

function fmtMoney(n: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

/**
 * The audit's teeth: with a connected store we read the last 30 days of
 * orders and abandoned checkouts (read-only Admin API) and turn "you
 * probably lose carts" into "you lost N checkouts worth $X this month".
 * Null when the token is dead or the API is unreachable — the public audit
 * still runs.
 */
export async function runDeepChecks(
  conn: ShopifyConnection,
): Promise<{ findings: AuditFinding[]; stats: AuditStats } | null> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent(since);
  const [os, checkoutsRes] = await Promise.all([
    fetchOrderStats(conn, 30),
    shopifyGet<{ checkouts?: ShopifyCheckout[] }>(
      conn.shop_domain,
      conn.access_token,
      `checkouts.json?limit=250&created_at_min=${q}`,
    ),
  ]);
  if (!os.fetched && !checkoutsRes) return null;

  const currency = os.currency;
  const checkouts = checkoutsRes?.checkouts ?? [];

  const revenue30 = os.revenue;
  const orders30 = os.orders;
  const aov = os.aov;
  const repeatRate = os.repeatRate;

  const abandoned30 = checkouts.length;
  const abandonedValue30 = checkouts.reduce((n, c) => n + (parseFloat(c.total_price ?? "0") || 0), 0);

  const findings: AuditFinding[] = [];

  if (abandoned30 > 0) {
    findings.push({
      id: "abandoned-carts",
      title: `${abandoned30} abandoned checkout${abandoned30 > 1 ? "s" : ""} worth ${fmtMoney(abandonedValue30, currency)} in the last 30 days`,
      impact: 5,
      detail: `Shoppers put ${fmtMoney(abandonedValue30, currency)} in their carts this month and never finished checkout${abandoned30 >= 250 ? " (and that's just the first 250 we counted)" : ""}. A 3-touch recovery sequence typically wins back 5–15% of that — this is the single fastest money on the table.`,
    });
  }

  if (orders30 >= 10 && repeatRate !== null && repeatRate < 0.15) {
    findings.push({
      id: "low-repeat-rate",
      title: `Only ${Math.round(repeatRate * 100)}% of this month's customers came back`,
      impact: 4,
      detail: `Of ${os.uniqueCustomers} customers in 30 days, just ${Math.round(repeatRate * 100)}% bought more than once. Win-back emails and review requests to past buyers are the cheapest revenue you're not collecting — new-customer ads cost 5–10× more.`,
    });
  }

  return {
    findings,
    stats: { currency, orders30, revenue30, aov, repeatRate, abandoned30, abandonedValue30 },
  };
}

// ---------------------------------------------------------------------------
// LLM prose (optional — template text above is the fallback)

const TEMPLATE_SUMMARY = (host: string, findings: AuditFinding[]) =>
  findings.length === 0
    ? `${host} looks solid on the basics — nice work. The next wins are in growth levers, not fixes.`
    : `We found ${findings.length} place${findings.length > 1 ? "s" : ""} where ${host} is losing sales. The top ones below are fixable this week.`;

/**
 * One non-streaming Groq call that rewrites each finding's detail for this
 * specific store and writes a 2-sentence summary. Any failure → templates.
 */
export async function writeProse(
  findings: AuditFinding[],
  meta: { host: string; platform: string; productCount: number | null },
  env: AuditEnv,
): Promise<{ summary: string; findings: AuditFinding[] }> {
  const fallback = { summary: TEMPLATE_SUMMARY(meta.host, findings), findings };
  if (!env.groqKey || findings.length === 0) return fallback;

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
      body: JSON.stringify({
        model: env.groqModel || CHAT_MODEL_DEFAULT,
        temperature: 0.4,
        max_tokens: 700,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are Evolution, an AI COO for ecommerce stores, writing a free store audit. Rewrite each finding\'s "detail" to be specific to this store: concrete, direct, founder-to-founder tone, 1–3 sentences, no fluff, mention evidence when given. Also write a 2-sentence "summary" of the audit. Respond ONLY with JSON: {"summary": string, "findings": [{"id": string, "detail": string}]}. Keep every finding id unchanged.',
          },
          {
            role: "user",
            content: JSON.stringify({
              store: meta.host,
              platform: meta.platform,
              productCount: meta.productCount,
              findings: findings.map((f) => ({
                id: f.id,
                title: f.title,
                detail: f.detail,
                evidence: f.evidence,
              })),
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return fallback;

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "") as {
      summary?: string;
      findings?: { id?: string; detail?: string }[];
    };
    const byId = new Map(
      (parsed.findings ?? [])
        .filter((f) => typeof f.id === "string" && typeof f.detail === "string" && f.detail.trim())
        .map((f) => [f.id!, f.detail!.trim()]),
    );
    return {
      summary: parsed.summary?.trim() || fallback.summary,
      findings: findings.map((f) => ({ ...f, detail: byId.get(f.id) ?? f.detail })),
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Persistence (service role, bypasses RLS — the audits table has no client
// insert policy on purpose; anonymous store URLs are lead capture)

/** Resolve the signed-in user from a client bearer token, if one was sent. */
export async function resolveUser(env: AuditEnv, authHeader: string | null): Promise<string | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.supabaseUrl || !env.serviceRoleKey) return null;
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return typeof user.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

/** Like resolveUser, but also returns the email (for team notifications). */
export async function resolveUserFull(
  env: AuditEnv,
  authHeader: string | null,
): Promise<{ id: string; email: string | null } | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.supabaseUrl || !env.serviceRoleKey) return null;
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string };
    if (typeof user.id !== "string") return null;
    return { id: user.id, email: typeof user.email === "string" ? user.email : null };
  } catch {
    return null;
  }
}

export async function persistAudit(env: AuditEnv, report: AuditReport, userId: string | null): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/audits`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        store_url: report.storeUrl,
        score: report.score,
        report,
      }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    /* lead capture is best-effort; never fail the audit over it */
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — the whole pipeline, shared verbatim by edge and dev

export async function runAudit(
  rawUrl: unknown,
  authHeader: string | null,
  env: AuditEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const normalized = normalizeStoreUrl(rawUrl);
  if ("error" in normalized) return { status: 400, body: { error: normalized.error } };

  // Public scan and (for signed-in owners with a Shopify connection) the
  // authenticated deep scan run in parallel — neither waits on the other.
  const snapshotPromise = fetchStore(normalized.host);
  const userId = await resolveUser(env, authHeader);
  const conn = userId ? await getConnection(env, userId) : null;
  const [snapshot, deep] = await Promise.all([
    snapshotPromise,
    conn ? runDeepChecks(conn) : Promise.resolve(null),
  ]);

  const publicSurface = Boolean(snapshot.html || snapshot.products);
  if (snapshot.passwordProtected && !deep) {
    return {
      status: 422,
      body: { error: "Your store is password-protected, so we can't audit it from the outside. Remove the password page (or email us) and try again." },
    };
  }
  if (!publicSurface && !deep) {
    return {
      status: 422,
      body: { error: "We couldn't reach that store. Check the URL — or if your store blocks bots, email us and a founder will run the audit by hand." },
    };
  }

  // Public checks only when there was a public surface to check — otherwise
  // "no apps detected" would just mean "we saw nothing".
  let rawFindings = publicSurface && !snapshot.passwordProtected ? runChecks(snapshot) : [];
  if (deep) {
    // Real abandoned-cart numbers supersede the pattern-guessed version.
    if (deep.findings.some((f) => f.id === "abandoned-carts")) {
      rawFindings = rawFindings.filter((f) => f.id !== "no-cart-recovery");
    }
    rawFindings = [...deep.findings, ...rawFindings].sort((a, b) => b.impact - a.impact);
  }

  const platform = snapshot.isShopify || conn ? "shopify" : "unknown";
  const productCount = snapshot.products?.length ?? null;
  const { summary, findings } = await writeProse(
    rawFindings,
    { host: normalized.host, platform, productCount },
    env,
  );

  const report: AuditReport = {
    storeUrl: normalized.url,
    platform,
    score: scoreAudit(findings),
    summary,
    productCount,
    findings,
    connected: Boolean(deep),
    stats: deep?.stats,
  };

  await persistAudit(env, report, userId);

  return { status: 200, body: report as unknown as Record<string, unknown> };
}
