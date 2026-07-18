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

export interface AuditReport {
  storeUrl: string;
  platform: "shopify" | "unknown";
  score: number;
  summary: string;
  productCount: number | null;
  findings: AuditFinding[];
}

interface ShopifyVariant {
  available?: boolean;
}
interface ShopifyProduct {
  title?: string;
  body_html?: string | null;
  images?: unknown[];
  variants?: ShopifyVariant[];
}

export interface AuditEnv {
  groqKey?: string;
  groqModel?: string;
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
  products: ShopifyProduct[] | null;
  passwordProtected: boolean;
  isShopify: boolean;
}

/** Fetch homepage HTML and /products.json in parallel. Public data only. */
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

  return { html, products, passwordProtected, isShopify };
}

// ---------------------------------------------------------------------------
// Rule checks

const APP_PATTERNS = {
  reviews: /judge\.me|judgeme|loox|yotpo|stamped\.io|okendo|junip|reviews\.io|trustpilot/i,
  emailCapture: /klaviyo|omnisend|privy|postscript|attentive|mailchimp|sendlane|drip\.com/i,
  upsell: /rebuy|zipify|aftersell|boldapps|candyrack|selleasy|upcart|honeycombupsell/i,
};

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html: string, pattern: RegExp): string {
  const tag = html.match(pattern)?.[0] ?? "";
  return tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
}

/** Deterministic findings, ranked by impact. The LLM only rewrites prose. */
export function runChecks(snapshot: StoreSnapshot): AuditFinding[] {
  const { html, products } = snapshot;
  const findings: AuditFinding[] = [];

  if (!APP_PATTERNS.emailCapture.test(html)) {
    findings.push({
      id: "no-cart-recovery",
      title: "No cart-recovery or email capture detected",
      impact: 5,
      detail:
        "We found no email/SMS marketing app (Klaviyo, Omnisend, Privy, Postscript…) on your storefront. Roughly 7 in 10 carts are abandoned — without recovery emails those sales are simply lost.",
    });
  }

  if (!APP_PATTERNS.reviews.test(html)) {
    findings.push({
      id: "no-reviews",
      title: "No customer reviews shown",
      impact: 4,
      detail:
        "We couldn't detect a reviews app (Judge.me, Loox, Yotpo…). Social proof is one of the highest-leverage conversion levers — stores without visible reviews convert significantly worse.",
    });
  }

  if (!APP_PATTERNS.upsell.test(html)) {
    findings.push({
      id: "no-upsells",
      title: "No upsell or cross-sell in the purchase flow",
      impact: 4,
      detail:
        "No upsell/cross-sell app detected. Post-purchase and in-cart offers are the cheapest way to raise average order value — you're leaving revenue on every order.",
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

  const snapshot = await fetchStore(normalized.host);

  if (snapshot.passwordProtected) {
    return {
      status: 422,
      body: { error: "Your store is password-protected, so we can't audit it from the outside. Remove the password page (or email us) and try again." },
    };
  }
  if (!snapshot.html && !snapshot.products) {
    return {
      status: 422,
      body: { error: "We couldn't reach that store. Check the URL — or if your store blocks bots, email us and a founder will run the audit by hand." },
    };
  }

  const rawFindings = runChecks(snapshot);
  const platform = snapshot.isShopify ? "shopify" : "unknown";
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
  };

  const userId = await resolveUser(env, authHeader);
  await persistAudit(env, report, userId);

  return { status: 200, body: report as unknown as Record<string, unknown> };
}
