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
import { getConnection, type ShopifyConnection } from "./_shopify";
import { fetchOrdersWindow, fetchAbandonedCheckoutsWindow, fetchShopCurrency } from "./_shopifyData";
import { checkRateLimit, hashKey } from "./_ratelimit";
import { log } from "./_log";

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

/** Catalog stats computed from public /products.json — no auth needed. */
export interface AuditCatalog {
  /** Items returned (the endpoint caps at 250). */
  products: number;
  /** True when exactly 250 came back — the real catalog is likely bigger. */
  capped: boolean;
  soldOut: number;
  thinDescriptions: number;
  noImages: number;
  avgImages: number | null;
  priceMin: number | null;
  priceMax: number | null;
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
  /** Public catalog stats — present whenever /products.json was readable. */
  catalog?: AuditCatalog;
  /** What the scan covered and which tech it saw — the report's receipts. */
  scanned?: { pages: string[]; detected: string[] };
  /** Page-by-page verdicts for every URL the crawl fetched. */
  pages?: PageAudit[];
}

interface ShopifyVariant {
  available?: boolean;
  price?: string;
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

  // Owners often paste their Shopify admin URL instead of the storefront.
  // admin.shopify.com/store/{handle} names the shop, so translate it; a bare
  // admin URL gets an explanation of what to paste instead.
  if (host === "admin.shopify.com") {
    const m = parsed.pathname.match(/^\/store\/([a-z0-9][a-z0-9-]*)/i);
    if (m) {
      const shopHost = `${m[1].toLowerCase()}.myshopify.com`;
      return { url: `https://${shopHost}`, host: shopHost };
    }
    return {
      error:
        "That's your Shopify admin, not your storefront. Paste your store's public address — like mystore.com or mystore.myshopify.com.",
    };
  }
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

/** Fetch one page, status included — null only on network failure/timeout. */
async function fetchPage(
  url: string,
): Promise<{ status: number; text: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(AUDIT_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    const text = res.ok ? await readCapped(res) : "";
    return { status: res.status, text, finalUrl: res.url || url };
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<{ text: string; finalUrl: string } | null> {
  const page = await fetchPage(url);
  if (!page || page.status < 200 || page.status >= 300) return null;
  return { text: page.text, finalUrl: page.finalUrl };
}

export type PageKind = "homepage" | "product" | "collection" | "page" | "blog";

/** One crawled page — raw material for the page-by-page audit. */
export interface CrawledPage {
  /** Path form for display (e.g. "/products/x"); fetched as https://host+path. */
  path: string;
  kind: PageKind;
  /** 0 = network failure/timeout. */
  status: number;
  html: string;
}

/** The per-page verdict that ships in the report. */
export interface PageAudit {
  path: string;
  kind: PageKind;
  title: string | null;
  issues: string[];
}

export interface StoreSnapshot {
  host: string;
  html: string;
  /** Every fetched page's HTML — where apps actually inject scripts. */
  corpus: string;
  /** All crawled pages beyond the homepage (products, collections, pages…). */
  crawled: CrawledPage[];
  products: ShopifyProduct[] | null;
  passwordProtected: boolean;
  isShopify: boolean;
  /** Shopify policy pages that resolved (null = not checked / not Shopify). */
  policies: { refund: boolean; shipping: boolean } | null;
  /** Latest blog-post date (ISO) when a blog feed was found; null date = feed
   * found but unparseable; undefined = no blog discovered. */
  blogLatest?: string | null;
}

/** Pull same-host links out of homepage HTML, bucketed by what they lead to. */
export function extractLinks(html: string, host: string): {
  products: string[];
  collections: string[];
  contact: string | null;
  about: string | null;
  blog: string | null;
  other: string[];
} {
  const products: string[] = [];
  const collections: string[] = [];
  const other: string[] = [];
  let contact: string | null = null;
  let about: string | null = null;
  let blog: string | null = null;

  const seen = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#?\s]+)[^"']*["']/gi)) {
    let raw = m[1];
    if (/^(mailto:|tel:|javascript:)/i.test(raw)) continue;
    // Absolute URLs: keep only same-host, reduce to path.
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        if (u.hostname.toLowerCase() !== host) continue;
        raw = u.pathname;
      } catch {
        continue;
      }
    }
    if (!raw.startsWith("/")) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|pdf|xml|json|woff2?)$/i.test(raw)) continue;
    const path = raw.replace(/\/+$/, "") || "/";
    if (path === "/" || seen.has(path)) continue;
    seen.add(path);

    if (/^\/(?:[a-z-]+\/)?products\//i.test(path)) products.push(path);
    else if (/^\/(?:[a-z-]+\/)?collections\//i.test(path)) collections.push(path);
    else if (!contact && /contact/i.test(path)) contact = path;
    else if (!about && /about/i.test(path)) about = path;
    else if (!blog && /^\/blogs?\//i.test(path)) blog = path;
    else if (!/\/(cart|account|login|checkout|search|policies)\b/i.test(path)) other.push(path);
  }
  return { products, collections, contact, about, blog, other };
}

/** Wave-2 crawl budget — enough for a real page-by-page report, small enough
 * to stay polite and inside the edge time budget (all fetches are parallel). */
const CRAWL_MAX_PRODUCTS = 4;
const CRAWL_MAX_COLLECTIONS = 2;
const CRAWL_MAX_OTHER = 2;

/**
 * Fetch the store's public surface in two waves: homepage + /products.json
 * first, then — informed by those — a parallel crawl of real pages: product
 * pages (where apps actually inject scripts), collection pages, contact and
 * about pages, the blog feed, and the Shopify policy pages. Every crawled
 * page gets its own entry in the report.
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
  const crawled: CrawledPage[] = [];
  let policies: StoreSnapshot["policies"] = null;
  let blogLatest: string | null | undefined;
  if (!passwordProtected && (html || products)) {
    const links = extractLinks(html, host);

    // Product pages: prefer real handles from products.json (guaranteed to
    // exist), fall back to product links found on the homepage.
    const productPaths =
      products && products.length > 0
        ? products
            .filter((p) => typeof p.handle === "string")
            .slice(0, CRAWL_MAX_PRODUCTS)
            .map((p) => `/products/${p.handle}`)
        : links.products.slice(0, CRAWL_MAX_PRODUCTS);

    const targets: { path: string; kind: PageKind }[] = [
      ...productPaths.map((path) => ({ path, kind: "product" as PageKind })),
      ...links.collections.slice(0, CRAWL_MAX_COLLECTIONS).map((path) => ({ path, kind: "collection" as PageKind })),
      ...(links.contact ? [{ path: links.contact, kind: "page" as PageKind }] : []),
      ...(links.about ? [{ path: links.about, kind: "page" as PageKind }] : []),
      ...(links.blog ? [{ path: links.blog, kind: "blog" as PageKind }] : []),
      ...links.other.slice(0, CRAWL_MAX_OTHER).map((path) => ({ path, kind: "page" as PageKind })),
    ];

    // Shopify blogs expose an Atom feed at /blogs/<name>.atom — the cheapest
    // honest answer to "when did they last publish?".
    const blogFeedPath =
      isShopify && links.blog
        ? (links.blog.match(/^(\/blogs\/[^/]+)/i)?.[1] ?? links.blog) + ".atom"
        : null;

    const [pages, refund, shipping, blogFeed] = await Promise.all([
      Promise.all(targets.map((t) => fetchPage(`https://${host}${t.path}`))),
      isShopify ? fetchText(`https://${host}/policies/refund-policy`) : Promise.resolve(null),
      isShopify ? fetchText(`https://${host}/policies/shipping-policy`) : Promise.resolve(null),
      blogFeedPath ? fetchText(`https://${host}${blogFeedPath}`) : Promise.resolve(null),
    ]);

    targets.forEach((t, i) => {
      const page = pages[i];
      crawled.push({ path: t.path, kind: t.kind, status: page?.status ?? 0, html: page?.text ?? "" });
    });

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

    if (links.blog) {
      const dates = [...(blogFeed?.text ?? "").matchAll(/<(?:updated|published|pubDate)>([^<]+)</gi)]
        .map((m) => Date.parse(m[1]))
        .filter((t) => Number.isFinite(t));
      blogLatest = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
    }
  }

  return {
    host,
    html,
    corpus: [html, ...crawled.map((p) => p.html)].join("\n"),
    crawled,
    products,
    passwordProtected,
    isShopify,
    policies,
    blogLatest,
  };
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

/** Human-readable list of what each negative check actually looked for —
 * quoted in the finding's evidence so "not detected" reads as a real scan,
 * not a guess. */
const APP_CHECKLISTS: Record<keyof typeof APP_PATTERNS, string> = {
  reviews: "Judge.me, Loox, Yotpo, Stamped, Okendo, Junip, Reviews.io, Trustpilot",
  emailCapture: "Klaviyo, Omnisend, Privy, Postscript, Attentive, Mailchimp, Sendlane, Drip",
  upsell: "Rebuy, Zipify, AfterSell, Bold, Candy Rack, SellEasy, UpCart, Honeycomb",
  support: "Gorgias, Tidio, Zendesk, Intercom, Crisp, Chatra, Re:amaze, tawk.to, Richpanel",
  pixel: "Meta pixel, Google tag / GA4, TikTok pixel, LinkedIn Insight, Pinterest tag",
};

/** Named tech we can positively identify — the report's "detected" receipts. */
const TECH_DETECTORS: { name: string; re: RegExp }[] = [
  { name: "Klaviyo", re: /klaviyo/i },
  { name: "Omnisend", re: /omnisend/i },
  { name: "Privy", re: /privy/i },
  { name: "Postscript", re: /postscript/i },
  { name: "Attentive", re: /attentive/i },
  { name: "Mailchimp", re: /mailchimp/i },
  { name: "Judge.me", re: /judge\.me|judgeme/i },
  { name: "Loox", re: /loox/i },
  { name: "Yotpo", re: /yotpo/i },
  { name: "Stamped", re: /stamped\.io/i },
  { name: "Okendo", re: /okendo/i },
  { name: "Trustpilot", re: /trustpilot/i },
  { name: "Rebuy", re: /rebuy/i },
  { name: "Zipify", re: /zipify/i },
  { name: "Gorgias", re: /gorgias/i },
  { name: "Tidio", re: /tidio/i },
  { name: "Zendesk", re: /zendesk/i },
  { name: "Intercom", re: /intercom/i },
  { name: "Crisp", re: /crisp\.chat/i },
  { name: "tawk.to", re: /tawk\.to/i },
  { name: "Meta pixel", re: /fbevents\.js|connect\.facebook\.net/i },
  { name: "Google tag / GA4", re: /gtag\/js|googletagmanager/i },
  { name: "TikTok pixel", re: /analytics\.tiktok/i },
  { name: "LinkedIn Insight", re: /snap\.licdn/i },
  { name: "Pinterest tag", re: /pintrk/i },
  { name: "Shop Pay / express checkout", re: /shopify-payment-button|shop-pay|dynamic-checkout/i },
];

export function detectTech(corpus: string): string[] {
  return TECH_DETECTORS.filter((d) => d.re.test(corpus)).map((d) => d.name);
}

/** Catalog stats from public /products.json — real numbers, no auth. */
export function computeCatalog(products: ShopifyProduct[] | null): AuditCatalog | undefined {
  if (!products || products.length === 0) return undefined;
  const soldOut = products.filter(
    (p) => (p.variants?.length ?? 0) > 0 && p.variants!.every((v) => v.available === false),
  ).length;
  const thin = products.filter((p) => stripHtml(p.body_html).length < 200).length;
  const noImages = products.filter((p) => (p.images?.length ?? 0) === 0).length;
  const imageTotal = products.reduce((n, p) => n + (p.images?.length ?? 0), 0);

  let priceMin: number | null = null;
  let priceMax: number | null = null;
  for (const p of products) {
    for (const v of p.variants ?? []) {
      const price = Number.parseFloat(v.price ?? "");
      if (!Number.isFinite(price) || price <= 0) continue;
      priceMin = priceMin === null ? price : Math.min(priceMin, price);
      priceMax = priceMax === null ? price : Math.max(priceMax, price);
    }
  }

  return {
    products: products.length,
    capped: products.length >= 250,
    soldOut,
    thinDescriptions: thin,
    noImages,
    avgImages: products.length > 0 ? Math.round((imageTotal / products.length) * 10) / 10 : null,
    priceMin,
    priceMax,
  };
}

export function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html: string, pattern: RegExp): string {
  const tag = html.match(pattern)?.[0] ?? "";
  return tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
}

/** Deterministic findings, ranked by impact — every one carries evidence
 * (what was scanned, what was found, the actual numbers). The LLM only
 * rewrites prose; it never invents facts. */
export function runChecks(snapshot: StoreSnapshot): {
  findings: AuditFinding[];
  checkedWeight: number;
  pages: PageAudit[];
} {
  const { html, corpus, crawled, products, policies, isShopify, blogLatest } = snapshot;
  const findings: AuditFinding[] = [];
  // Sum of the weights of every check we could actually evaluate — the score
  // is failed-weight over this, so passing checks earns credit and a store we
  // could only partially scan isn't judged on checks we never ran.
  let checkedWeight = 0;

  const livePages = crawled.filter((p) => p.status >= 200 && p.status < 400 && p.html);
  const productPages = livePages.filter((p) => p.kind === "product");
  const brokenPages = crawled.filter((p) => p.status >= 400);

  // The pages this scan actually covered — quoted in every "not detected"
  // finding so absence reads as verified, not guessed. (The homepage can be
  // empty when only /products.json was reachable.)
  const pageCount = (html ? 1 : 0) + livePages.length;
  const scannedLabel =
    pageCount > 1
      ? `${pageCount} pages of your site (homepage${productPages.length > 0 ? `, ${productPages.length} product page${productPages.length > 1 ? "s" : ""}` : ""}, and more)`
      : html
        ? "your homepage"
        : "your storefront";
  const notFound = (category: keyof typeof APP_CHECKLISTS) =>
    `Scanned ${scannedLabel} for ${APP_CHECKLISTS[category]} — none present.`;

  // App checks — evaluable whenever we had any storefront HTML at all.
  checkedWeight += 5 + 4 + 4 + 3 + 3;

  const hasEmailInput = /<input[^>]+type=["']email["']/i.test(html);
  if (!APP_PATTERNS.emailCapture.test(corpus)) {
    findings.push({
      id: "no-cart-recovery",
      title: "No cart-recovery or email capture detected",
      impact: 5,
      detail: hasEmailInput
        ? "Your homepage has an email signup form, but no marketing platform (Klaviyo, Omnisend…) is behind it — so nothing automatically emails the shoppers who abandon carts. Roughly 7 in 10 carts are abandoned; without recovery emails those sales are simply lost."
        : "We found no email/SMS marketing app and no email signup form on your storefront. Roughly 7 in 10 carts are abandoned — without capture and recovery emails those sales are simply lost.",
      evidence: [
        notFound("emailCapture"),
        hasEmailInput
          ? "An email <input> field exists on the homepage, with no automation platform connected to it."
          : "No email signup field found on the homepage either.",
      ],
    });
  }

  const hasRatingSchema = productPages.some((p) => /aggregateRating|"ratingValue"/i.test(p.html));
  if (!APP_PATTERNS.reviews.test(corpus) && !hasRatingSchema) {
    findings.push({
      id: "no-reviews",
      title: "No customer reviews shown",
      impact: 4,
      detail:
        "No reviews app and no star-rating markup detected. Social proof is one of the highest-leverage conversion levers — stores without visible reviews convert significantly worse.",
      evidence: [
        notFound("reviews"),
        productPages.length > 0
          ? `No review widget or rating schema (aggregateRating) on ${productPages.map((p) => p.path).join(", ")}.`
          : "No product page was reachable to check for review widgets.",
      ],
    });
  }

  if (!APP_PATTERNS.upsell.test(corpus)) {
    findings.push({
      id: "no-upsells",
      title: "No upsell or cross-sell in the purchase flow",
      impact: 4,
      detail:
        "No upsell/cross-sell app detected. Post-purchase and in-cart offers are the cheapest way to raise average order value — you're leaving revenue on every order.",
      evidence: [notFound("upsell")],
    });
  }

  if (!APP_PATTERNS.support.test(corpus)) {
    findings.push({
      id: "no-support-channel",
      title: "No live support channel on the storefront",
      impact: 3,
      detail:
        "No chat widget or helpdesk detected. Pre-sale questions that can't be asked are sales that quietly walk away — especially on mobile.",
      evidence: [notFound("support")],
    });
  }

  if (!APP_PATTERNS.pixel.test(corpus)) {
    findings.push({
      id: "no-marketing-pixel",
      title: "No marketing or analytics pixel detected",
      impact: 3,
      detail:
        "We found no ad or analytics pixel. Without one you can't retarget visitors or measure which traffic actually buys — every ad dollar flies blind.",
      evidence: [notFound("pixel")],
    });
  }

  // Express checkout — Shopify renders the dynamic checkout button server-side
  // on product pages, so its absence there is a real signal.
  const expressRe = /shopify-payment-button|shop-pay|dynamic-checkout/i;
  if (isShopify && productPages.length > 0) {
    checkedWeight += 3;
    if (!productPages.some((p) => expressRe.test(p.html))) {
      findings.push({
        id: "no-express-checkout",
        title: "No express checkout on product pages",
        impact: 3,
        detail:
          "Shop Pay / dynamic checkout buttons aren't enabled on your product pages. One-tap wallets (Shop Pay, PayPal, Apple Pay) remove the checkout form entirely — Shopify reports Shop Pay checkouts convert meaningfully better than regular ones.",
        evidence: [
          `Checked ${productPages.map((p) => p.path).join(", ")} for the shopify-payment-button / Shop Pay markup — not present on any of them.`,
        ],
      });
    }
  }

  if (policies) checkedWeight += 2;
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
      evidence: [
        ...(!policies.refund ? ["/policies/refund-policy returns no written policy."] : []),
        ...(!policies.shipping ? ["/policies/shipping-policy returns no written policy."] : []),
      ],
    });
  }

  if (products && products.length > 0) {
    checkedWeight += 4 + 3 + 3;
    const catalogNote = products.length >= 250 ? " (of the first 250 we scanned)" : "";

    const thin = products
      .map((p) => ({ p, chars: stripHtml(p.body_html).length }))
      .filter((t) => t.chars < 200);
    if (thin.length > 0) {
      // Impact scales with prevalence: 1 thin page in a 141-product catalog
      // is housekeeping; a third of the catalog is a conversion problem.
      const share = thin.length / products.length;
      findings.push({
        id: "thin-descriptions",
        title: `Thin product descriptions on ${thin.length} of ${products.length} products${catalogNote}`,
        impact: share >= 0.3 ? 4 : share >= 0.1 ? 3 : 2,
        detail:
          "These product pages have under 200 characters of description — not enough to sell the product or rank in search. Every thin page is a landing page that can't close.",
        evidence: thin
          .slice(0, 3)
          .map((t) => `"${t.p.title ?? "(untitled)"}" — ${t.chars} characters of description`),
      });
    }

    const soldOut = products.filter(
      (p) => (p.variants?.length ?? 0) > 0 && p.variants!.every((v) => v.available === false),
    );
    if (soldOut.length > 0) {
      const pct = Math.round((soldOut.length / products.length) * 100);
      findings.push({
        id: "sold-out-dead-ends",
        title: `${soldOut.length} sold-out product${soldOut.length > 1 ? "s" : ""} (${pct}% of the catalog${catalogNote}) with no back-in-stock capture`,
        impact: soldOut.length / products.length >= 0.2 ? 3 : 2,
        detail:
          "Sold-out product pages are dead ends: shoppers land, see 'sold out', and leave forever. A 'notify me when it's back' form turns that demand into a launch list.",
        evidence: soldOut.slice(0, 3).map((p) => `"${p.title ?? "(untitled)"}" — every variant unavailable`),
      });
    }

    const noImages = products.filter((p) => (p.images?.length ?? 0) === 0);
    if (noImages.length > 0) {
      findings.push({
        id: "missing-images",
        title: `${noImages.length} product${noImages.length > 1 ? "s" : ""} without photos`,
        impact: 3,
        detail: "Products without a single image almost never sell online.",
        evidence: noImages.slice(0, 3).map((p) => `"${p.title ?? "(untitled)"}" — 0 images`),
      });
    }
  }

  if (html) {
    // Homepage checks: SEO (2), weight (3), contact (2), social (2).
    checkedWeight += 2 + 3 + 2 + 2;

    // Client-rendered storefront: the server HTML is a near-empty JS shell.
    // Everything that only appears after JS runs is invisible to first-pass
    // search/social crawlers — and to this scan, which the report should say.
    const bodyText = stripHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
    if (bodyText.length < 2000) {
      checkedWeight += 3;
      findings.push({
        id: "client-rendered",
        title: "Your storefront's HTML is nearly empty — content renders in the browser",
        impact: 3,
        detail:
          "Your server sends a JavaScript shell and builds the page in the visitor's browser. Search engines and link previews (WhatsApp, Instagram) read the raw HTML first — to them your store looks almost blank. Any 'not detected' findings below reflect that same first-pass view.",
        evidence: [
          `The homepage HTML contains only ${bodyText.length} characters of visible text.`,
        ],
      });
    }

    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const description = metaContent(html, /<meta[^>]+name=["']description["'][^>]*>/i);
    const ogImage = metaContent(html, /<meta[^>]+property=["']og:image["'][^>]*>/i);
    const seoProblems: string[] = [];
    const seoEvidence: string[] = [];
    if (title.length < 15) {
      seoProblems.push("a missing or very short <title> tag");
      seoEvidence.push(title ? `Title tag: "${title}" (${title.length} characters)` : "No <title> tag found.");
    }
    if (description.length < 50) {
      seoProblems.push("a missing or very short meta description");
      seoEvidence.push(
        description
          ? `Meta description: "${description.slice(0, 80)}${description.length > 80 ? "…" : ""}" (${description.length} characters — search engines show ~155)`
          : "No meta description found.",
      );
    }
    if (!ogImage) {
      seoProblems.push("no social-sharing image (og:image)");
      seoEvidence.push("No og:image tag — links shared on WhatsApp/Instagram/Facebook show no preview image.");
    }
    if (seoProblems.length > 0) {
      findings.push({
        id: "weak-seo",
        title: "Homepage SEO & social previews need work",
        impact: 2,
        detail: `Your homepage has ${seoProblems.join(", ")}. This hurts both search ranking and how your links look when shared.`,
        evidence: seoEvidence,
      });
    }

    // Page weight — we only see HTML (not images/JS payloads), but bloated
    // markup and script counts are a reliable proxy for slow mobile loads.
    const htmlKb = Math.round(html.length / 1024);
    const scriptCount = (html.match(/<script/gi) ?? []).length;
    if (htmlKb > 700 || scriptCount > 60) {
      findings.push({
        id: "heavy-homepage",
        title: "Homepage is heavy — mobile shoppers feel it",
        impact: 3,
        detail:
          "Every extra second of load time costs conversions, and most of your traffic is on a phone. An app-cleanup pass (uninstalled apps often leave scripts behind) is usually the quickest win.",
        evidence: [
          `Homepage HTML: ${htmlKb >= 1024 ? "over 1 MB" : `${htmlKb} KB`} (lean storefronts ship under ~300 KB of HTML).`,
          `${scriptCount} <script> tags on the homepage.`,
        ],
      });
    }

    const imgTags = html.match(/<img[^>]*>/gi) ?? [];
    const noAlt = imgTags.filter((t) => !/alt=["'][^"']+["']/i.test(t));
    if (imgTags.length >= 5) checkedWeight += 2;
    if (imgTags.length >= 5 && noAlt.length / imgTags.length > 0.4) {
      findings.push({
        id: "images-no-alt",
        title: "Most homepage images have no alt text",
        impact: 2,
        detail:
          "Alt text is how Google understands your product images — and how they surface in image search. Right now most of yours are invisible to it.",
        evidence: [`${noAlt.length} of ${imgTags.length} homepage <img> tags have no alt text.`],
      });
    }

    const contactPageLive = livePages.some((p) => /contact/i.test(p.path));
    if (!contactPageLive && !/mailto:|tel:|href=["'][^"']*contact/i.test(html)) {
      findings.push({
        id: "hard-to-contact",
        title: "No visible way to contact you",
        impact: 2,
        detail:
          "No contact link, email address, or phone number found on your homepage. Shoppers who can't see a human behind the store trust it less with their card — and ad platforms check for this too.",
        evidence: ["Scanned the homepage for a contact page link, mailto: or tel: — none found."],
      });
    }

    if (!/(instagram|facebook|tiktok|youtube|twitter|pinterest)\.com/i.test(html)) {
      findings.push({
        id: "no-social-links",
        title: "No social profiles linked from the storefront",
        impact: 2,
        detail:
          "No Instagram, TikTok, Facebook, YouTube or Pinterest links found. Shoppers routinely check a store's socials before a first purchase — an active profile is free trust.",
        evidence: ["Scanned homepage links for instagram.com, tiktok.com, facebook.com, youtube.com, pinterest.com — none found."],
      });
    }

  }

  // -- Crawl-wide checks: every one names the exact pages involved. --------

  const schemaRe = /schema\.org\/Product|"@type"\s*:\s*"Product"/i;
  if (productPages.length > 0) {
    checkedWeight += 2;
    const noSchema = productPages.filter((p) => !schemaRe.test(p.html));
    if (noSchema.length === productPages.length) {
      findings.push({
        id: "no-product-schema",
        title: `No structured data for Google on any of the ${productPages.length} product page${productPages.length > 1 ? "s" : ""} scanned`,
        impact: 2,
        detail:
          "Without Product schema (JSON-LD), Google can't show your price, availability, or stars in search results — competitors with rich snippets take that click.",
        evidence: noSchema.map((p) => `${p.path} — no schema.org Product markup`),
      });
    }
  }

  // Product pages that ship without a meta description can't pitch themselves
  // in search results — Google writes something arbitrary instead.
  if (productPages.length > 0) {
    checkedWeight += 2;
    const noDesc = productPages.filter(
      (p) => metaContent(p.html, /<meta[^>]+name=["']description["'][^>]*>/i).length < 50,
    );
    if (noDesc.length > 0) {
      findings.push({
        id: "product-pages-no-meta",
        title: `${noDesc.length} of ${productPages.length} product pages scanned have no meta description`,
        impact: 2,
        detail:
          "These pages let Google improvise their search snippet instead of pitching the product. A one-line benefit + offer per page is a same-day fix.",
        evidence: noDesc.map((p) => `${p.path} — missing or under 50 characters`),
      });
    }
  }

  // Broken pages the store itself links to — link rot shoppers actually hit.
  if (crawled.length >= 3) {
    checkedWeight += 3;
    if (brokenPages.length > 0) {
      findings.push({
        id: "broken-pages",
        title: `${brokenPages.length} broken page${brokenPages.length > 1 ? "s" : ""} linked from your own storefront`,
        impact: 3,
        detail:
          "These links are on your site right now and lead shoppers to error pages. Every one is a dead end you're sending your own traffic into.",
        evidence: brokenPages.map((p) => `${p.path} — HTTP ${p.status}`),
      });
    }
  }

  // Blog freshness — a discovered blog with a readable feed dates itself.
  if (blogLatest !== undefined && blogLatest !== null) {
    checkedWeight += 2;
    const ageDays = Math.floor((Date.now() - Date.parse(blogLatest)) / 86_400_000);
    if (ageDays > 120) {
      const months = Math.floor(ageDays / 30);
      findings.push({
        id: "stale-blog",
        title: `Blog has been silent for ${months} months`,
        impact: 2,
        detail:
          "A visibly abandoned blog reads as a visibly abandoned store — and Google notices the silence too. Either publish on a rhythm or remove the dates from view.",
        evidence: [`Latest post in your blog feed: ${blogLatest.slice(0, 10)}.`],
      });
    }
  }

  return {
    findings: findings.sort((a, b) => b.impact - a.impact),
    checkedWeight,
    pages: buildPageAudits(snapshot),
  };
}

/** The page-by-page table: one row per URL we fetched, with its verdicts. */
export function buildPageAudits(snapshot: StoreSnapshot): PageAudit[] {
  const { html, crawled, isShopify } = snapshot;
  const audits: PageAudit[] = [];

  const audit = (path: string, kind: PageKind, status: number, pageHtml: string): PageAudit => {
    const title = (pageHtml.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() || null;
    const issues: string[] = [];
    if (status === 0) {
      issues.push("unreachable — the page didn't respond");
      return { path, kind, title, issues };
    }
    if (status >= 400) {
      issues.push(`broken — returns HTTP ${status}`);
      return { path, kind, title, issues };
    }
    if (!title || title.length < 15) issues.push("missing or very short <title> tag");
    if (metaContent(pageHtml, /<meta[^>]+name=["']description["'][^>]*>/i).length < 50)
      issues.push("no meta description");
    const text = stripHtml(pageHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
    if (text.length < 300) issues.push(`almost no visible text (${text.length} characters)`);
    if (kind === "product") {
      if (!/schema\.org\/Product|"@type"\s*:\s*"Product"/i.test(pageHtml))
        issues.push("no Product structured data");
      if (!APP_PATTERNS.reviews.test(pageHtml) && !/aggregateRating|"ratingValue"/i.test(pageHtml))
        issues.push("no reviews visible");
      if (isShopify && !/shopify-payment-button|shop-pay|dynamic-checkout/i.test(pageHtml))
        issues.push("no express checkout");
    }
    return { path, kind, title, issues };
  };

  if (html) audits.push(audit("/", "homepage", 200, html));
  for (const p of crawled) audits.push(audit(p.path, p.kind, p.status, p.html));
  return audits;
}

/**
 * Failed weight over total weight actually checked — so a well-run store
 * that passes 14 of 16 checks scores in the 80s instead of being punished
 * for the audit's thoroughness, and a store we could only partially scan
 * isn't judged on checks that never ran. Floored/capped to stay honest but
 * motivating.
 */
export function scoreAudit(findings: AuditFinding[], checkedWeight: number): number {
  if (checkedWeight <= 0) return 50;
  const failed = findings.reduce((n, f) => n + f.impact, 0);
  const score = Math.round(100 * (1 - failed / checkedWeight));
  return Math.max(20, Math.min(98, score));
}

// ---------------------------------------------------------------------------
// Deep checks (Shopify OAuth) — real trading data, quantified findings

/**
 * Order-level trading stats for an arbitrary window — shared by the deep
 * audit (30 days) and the skill engine (up to 90 days). `fetched` is false
 * when the orders API was unreachable (stats are then all zeros).
 * Reads via _shopifyData.ts (GraphQL Admin API only — REST is legacy).
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
  const [currency, orders] = await Promise.all([
    fetchShopCurrency(conn),
    fetchOrdersWindow(conn, days),
  ]);

  const rows = orders ?? [];
  const revenue = rows.reduce((n, o) => n + o.totalPrice, 0);
  const aov = rows.length > 0 ? revenue / rows.length : null;

  const byCustomer = new Map<string, number>();
  for (const o of rows) {
    if (o.customerId) byCustomer.set(o.customerId, (byCustomer.get(o.customerId) ?? 0) + 1);
  }
  const repeatRate =
    byCustomer.size > 0
      ? [...byCustomer.values()].filter((c) => c > 1).length / byCustomer.size
      : null;

  const byWeek = new Map<string, { orders: number; revenue: number }>();
  for (const o of rows) {
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // snap to Sunday
    const key = d.toISOString().slice(0, 10);
    const bucket = byWeek.get(key) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += o.totalPrice;
    byWeek.set(key, bucket);
  }
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, w]) => ({ weekStart, orders: w.orders, revenue: Math.round(w.revenue) }));

  return {
    currency,
    days,
    fetched: orders !== null,
    orders: rows.length,
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
  const [os, checkoutsRes] = await Promise.all([
    fetchOrderStats(conn, 30),
    fetchAbandonedCheckoutsWindow(conn, 30),
  ]);
  if (!os.fetched && !checkoutsRes) return null;

  const currency = os.currency;
  const checkouts = checkoutsRes ?? [];

  const revenue30 = os.revenue;
  const orders30 = os.orders;
  const aov = os.aov;
  const repeatRate = os.repeatRate;

  const abandoned30 = checkouts.length;
  const abandonedValue30 = checkouts.reduce((n, c) => n + c.totalPrice, 0);

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
  meta: {
    host: string;
    platform: string;
    productCount: number | null;
    catalog?: AuditCatalog;
    detected?: string[];
    pagesAudited?: number;
  },
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
        max_tokens: 1000,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are Evolution, an AI COO for ecommerce stores, writing a free store audit. Rewrite each finding\'s "detail" to be specific to this store: concrete, direct, founder-to-founder tone, 1–3 sentences, no fluff. HARD RULES: use ONLY numbers and facts present in the input (titles, counts, sizes, evidence lines, catalog stats) — NEVER invent statistics, percentages, or benchmarks that are not in the input; keep any benchmark that IS in the input. Weave the strongest concrete fact into each detail (e.g. the actual product name, the actual character count, the actual dollar/count figure). Do not repeat the evidence list verbatim — it is shown separately under the finding. Also write a "summary": 2 sentences, leading with the single most expensive problem and one concrete number from the input. Respond ONLY with JSON: {"summary": string, "findings": [{"id": string, "detail": string}]}. Keep every finding id unchanged.',
          },
          {
            role: "user",
            content: JSON.stringify({
              store: meta.host,
              platform: meta.platform,
              productCount: meta.productCount,
              catalogStats: meta.catalog ?? null,
              techDetectedOnStore: meta.detected ?? [],
              pagesAudited: meta.pagesAudited ?? 0,
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

/** Signed-in owners audit their own store repeatedly while iterating. */
const AUDIT_LIMIT_USER_PER_HOUR = 30;
/** Anonymous funnel visitors rarely need more than a handful. */
const AUDIT_LIMIT_IP_PER_HOUR = 6;

export async function runAudit(
  rawUrl: unknown,
  authHeader: string | null,
  env: AuditEnv,
  clientIp: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const normalized = normalizeStoreUrl(rawUrl);
  if ("error" in normalized) return { status: 400, body: { error: normalized.error } };

  const userId = await resolveUser(env, authHeader);

  // Each audit costs storefront fetches + a Groq call + a DB row, and the
  // endpoint must stay public (it's the lead funnel) — so hit the fixed-window
  // limiter before any of that. checkRateLimit fails open.
  const rlKey = userId
    ? `audit:u:${userId}`
    : `audit:ip:${await hashKey(clientIp ?? "unknown")}`;
  const allowed = await checkRateLimit(
    env,
    rlKey,
    3_600,
    userId ? AUDIT_LIMIT_USER_PER_HOUR : AUDIT_LIMIT_IP_PER_HOUR,
  );
  if (!allowed) {
    log("warn", "audit", "rate_limited", { authed: Boolean(userId) });
    return {
      status: 429,
      body: { error: "That's a lot of audits in a row — try again in an hour, or email us for help." },
    };
  }

  // Public scan and (for signed-in owners with a Shopify connection) the
  // authenticated deep scan run in parallel — neither waits on the other.
  const snapshotPromise = fetchStore(normalized.host);
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
      body: { error: "We couldn't reach that store. Check the URL — or if your store blocks bots, email us for help getting connected." },
    };
  }

  // Public checks only when there was a public surface to check — otherwise
  // "no apps detected" would just mean "we saw nothing".
  const publicChecks =
    publicSurface && !snapshot.passwordProtected
      ? runChecks(snapshot)
      : { findings: [], checkedWeight: 0, pages: [] as PageAudit[] };
  let rawFindings = publicChecks.findings;
  let checkedWeight = publicChecks.checkedWeight;
  const pageAudits = publicChecks.pages;
  if (deep) {
    // Real abandoned-cart numbers supersede the pattern-guessed version.
    if (deep.findings.some((f) => f.id === "abandoned-carts")) {
      rawFindings = rawFindings.filter((f) => f.id !== "no-cart-recovery");
    }
    rawFindings = [...deep.findings, ...rawFindings].sort((a, b) => b.impact - a.impact);
    // The two deep checks (abandoned carts: 5, repeat rate: 4) were evaluated.
    checkedWeight += 9;
  }

  const platform = snapshot.isShopify || conn ? "shopify" : "unknown";
  const productCount = snapshot.products?.length ?? null;
  const catalog = computeCatalog(snapshot.products);

  // The report's receipts: pages covered + tech positively identified.
  const pages: string[] = pageAudits.map((p) => p.path);
  if (snapshot.products) pages.push(`/products.json (${snapshot.products.length} products)`);
  if (snapshot.policies) pages.push("policy pages");
  const detected = detectTech(snapshot.corpus);

  const { summary, findings } = await writeProse(
    rawFindings,
    {
      host: normalized.host,
      platform,
      productCount,
      catalog,
      detected,
      pagesAudited: pageAudits.length,
    },
    env,
  );

  const report: AuditReport = {
    storeUrl: normalized.url,
    platform,
    score: scoreAudit(findings, checkedWeight),
    summary,
    productCount,
    findings,
    connected: Boolean(deep),
    stats: deep?.stats,
    catalog,
    scanned: { pages, detected },
    pages: pageAudits.length > 0 ? pageAudits : undefined,
  };

  await persistAudit(env, report, userId);

  return { status: 200, body: report as unknown as Record<string, unknown> };
}
