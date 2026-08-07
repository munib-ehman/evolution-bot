/**
 * The product-hunt engine — shared by /api/product-hunt (edge) and dev-api.ts.
 *
 * The free tier's second feature (next to the audit): read the store's public
 * catalog to pin down what it sells, then have the web-search-capable research
 * model hunt 3 winning products for that niche — each with live trend
 * evidence, real sourcing (supplier + search term + listing URL + unit cost),
 * and a ready-to-paste listing (title, bullets, description, price).
 *
 * Streams SSE like the skill engine: progress lines while the research runs
 * (a compound search pass takes 20–60s), then {"report": …}, then [DONE].
 * Every number in the report must come from a search the model actually ran —
 * the prompt forbids invented stats, and the store's own catalog is passed in
 * so the hunt never recommends what the founder already sells.
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT, RESEARCH_MODEL_DEFAULT } from "./_shared";
import { normalizeStoreUrl, fetchText, stripHtml, resolveUserFull, type AuditEnv } from "./_audit";
import { checkRateLimit } from "./_ratelimit";
import { log } from "./_log";

// ---------------------------------------------------------------------------
// Report schema (mirrored client-side in src/lib/hunt.ts)

export interface HuntStat {
  label: string;
  value: string;
}
export interface HuntSourcing {
  supplier: string;
  searchTerm: string;
  url?: string;
  unitCost?: string;
}
export interface HuntSource {
  title: string;
  url: string;
}
export interface HuntListing {
  title: string;
  price: string;
  bullets: string[];
  description: string;
}
export interface HuntProduct {
  name: string;
  hook: string;
  whyWinning: string;
  stats: HuntStat[];
  sourcing: HuntSourcing[];
  listing: HuntListing;
  fit: string;
  sources: HuntSource[];
}
export interface HuntReport {
  storeUrl: string;
  niche: string;
  audience: string;
  summary: string;
  products: HuntProduct[];
  generatedAt: string;
}

/** Hunts are the priciest free call we run (a live search pass) — cap hard. */
const HUNT_LIMIT_USER_PER_DAY = 5;
const RESEARCH_TIMEOUT_MS = 90_000;

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const sseDone = enc.encode("data: [DONE]\n\n");

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---------------------------------------------------------------------------
// Step 1 — what does this store sell? (public data only)

interface CatalogDigest {
  host: string;
  storeTitle: string;
  storeDescription: string;
  priceBand: string | null;
  productTitles: string[];
}

export async function readCatalog(host: string): Promise<CatalogDigest | null> {
  const [homepage, productsRaw] = await Promise.all([
    fetchText(`https://${host}/`),
    fetchText(`https://${host}/products.json?limit=250`),
  ]);

  const html = homepage?.text ?? "";
  let titles: string[] = [];
  let priceBand: string | null = null;
  if (productsRaw) {
    try {
      const parsed = JSON.parse(productsRaw.text) as {
        products?: { title?: string; variants?: { price?: string }[] }[];
      };
      const products = Array.isArray(parsed.products) ? parsed.products : [];
      titles = products
        .map((p) => (typeof p.title === "string" ? p.title : ""))
        .filter(Boolean);
      const prices = products
        .flatMap((p) => p.variants ?? [])
        .map((v) => Number.parseFloat(v.price ?? ""))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (prices.length > 0) {
        priceBand = `${Math.round(Math.min(...prices))}–${Math.round(Math.max(...prices))} (store currency)`;
      }
    } catch {
      /* not a Shopify products endpoint */
    }
  }

  const storeTitle = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const storeDescription =
    (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "").trim() ||
    stripHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")).slice(0, 400);

  if (!storeTitle && titles.length === 0 && storeDescription.length < 40) return null;
  return { host, storeTitle, storeDescription, priceBand, productTitles: titles.slice(0, 30) };
}

// ---------------------------------------------------------------------------
// Step 2 — the research pass (live web search)

const REPORT_SHAPE = `{
  "niche": "what this store sells, in a few words",
  "audience": "who buys from it, in a few words",
  "summary": "2 sentences: the niche you identified and which product you'd launch first and why",
  "products": [
    {
      "name": "product name",
      "hook": "one-line selling hook",
      "whyWinning": "2-3 sentences of trend evidence from your searches — name where the demand is showing up",
      "stats": [{"label": "short stat label", "value": "the number/fact, from a search result"}],
      "sourcing": [{"supplier": "AliExpress|Alibaba|CJdropshipping|Zendrop|Faire|…", "searchTerm": "what to search there", "url": "listing or search URL you found", "unitCost": "e.g. $4–7"}],
      "listing": {"title": "ready-to-use product page title, under 70 chars", "price": "suggested retail with currency", "bullets": ["5 benefit-first bullets"], "description": "120-170 word ready-to-paste product description"},
      "fit": "one sentence: why this suits THIS store and its price band",
      "sources": [{"title": "page title", "url": "https://…"}]
    }
  ]
}`;

/**
 * Stage A runs on the compound (search-capable) model and writes research
 * NOTES in markdown — the same shape as the proven product_research skill.
 * Demanding strict JSON here reliably suppresses compound's search tool
 * (verified 2026-07-29: it then refuses with "I can't search"), so the JSON
 * structuring is a separate stage-B call on the chat model.
 */
const RESEARCH_SYSTEM = `You are Evolution's product hunter — the research engine behind an AI COO for ecommerce stores. The user message carries a digest of the founder's REAL store catalog — use it to pin down the niche, audience, and price band. Everything about the MARKET must come from live web searches you run now: current trending-product and marketplace best-seller roundups in and adjacent to the niche, demand signals (search-trend and social-trend reports, TikTok/Instagram traction), and actual supplier listings (AliExpress, Alibaba, CJdropshipping, Zendrop, Faire) for unit costs. Put a source link next to every trend claim, price benchmark, and supplier. If a search didn't verify something, leave it out — never invent products, stats, or links.

Write research notes in markdown:
- First: the store's niche and audience in one line each, then 2 sentences on which product you'd launch first and why.
- Then "## {n}. {Product}" per product — exactly 3 products, genuinely different from each other, and none of them something the store already sells (its current titles are in the digest):
  - **Why it's winning now** — the trend evidence you found, each claim with its source URL.
  - **Numbers** — 3-5 concrete stats from your searches: supplier unit cost, typical retail, review counts, trend direction, social traction. A founder should feel the demand is real.
  - **Sourcing** — 2-3 named suppliers with what to search there, the listing/search URL you found, and the unit cost you saw.
  - **Draft listing** — a product-page title under 70 characters, a suggested retail price that fits the store's price band with 60%+ margin over the unit cost, 5 benefit-first bullets, and a 120-170 word product description. No invented reviews or certifications, no medical or income claims.
  - **Fit** — one sentence on why it suits THIS store and its price band.`;

export async function researchCall(
  digest: CatalogDigest,
  env: AuditEnv,
): Promise<{ content: string | null; failure: ResearchFailure }> {
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
      body: JSON.stringify({
        model: env.groqResearchModel || RESEARCH_MODEL_DEFAULT,
        temperature: 0.3,
        // 3 products × (evidence + stats + sourcing + full listing) is long —
        // a tight cap truncates the notes and stage B can only salvage 1-2.
        max_tokens: 5000,
        stream: false,
        messages: [
          { role: "system", content: RESEARCH_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              store: digest.host,
              storeTitle: digest.storeTitle,
              storeDescription: digest.storeDescription,
              priceBand: digest.priceBand,
              currentCatalog: digest.productTitles,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as {
        error?: { code?: string; type?: string };
      } | null;
      const code = detail?.error?.code ?? detail?.error?.type ?? "unknown";
      log("warn", "hunt", "research_upstream_error", { status: res.status, code });
      return {
        content: null,
        failure:
          res.status === 401 || res.status === 403
            ? "auth"
            : res.status === 429
              ? "rate_limit"
              : res.status === 413
                ? "payload"
                : "upstream",
      };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? null;
    return { content, failure: content ? null : "empty" };
  } catch (err) {
    log("warn", "hunt", "research_failed", { err: String(err) });
    return {
      content: null,
      failure: err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "upstream",
    };
  }
}

type ResearchFailure = "auth" | "rate_limit" | "payload" | "timeout" | "upstream" | "empty" | null;

function researchFailureMessage(failure: ResearchFailure): string {
  if (failure === "auth") {
    return "Live research is temporarily unavailable because its service credentials need attention. We've logged the issue — please try again later.";
  }
  if (failure === "rate_limit") {
    return "Live research is busy right now — give it about 60 seconds and run it again.";
  }
  if (failure === "payload") {
    return "The research provider rejected this catalog as too large. We've logged the issue — please try again later.";
  }
  if (failure === "timeout") {
    return "Live research took too long to respond — give it a minute and run it again.";
  }
  return "Live research couldn't complete this run — give it about 60 seconds and try again.";
}

/** Stage B: the chat model structures the research notes into the schema.
 * `capacity` = the upstream refused the request (rate limit / overload) —
 * the notes were fine, so the caller should say "try again shortly", not
 * blame the research. */
export async function reformatCall(
  raw: string,
  env: AuditEnv,
): Promise<{ content: string | null; capacity: boolean }> {
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
      body: JSON.stringify({
        model: env.groqModel || CHAT_MODEL_DEFAULT,
        temperature: 0,
        max_tokens: 3800,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Convert the research notes you are given into EXACTLY this JSON shape, preserving every fact, number, and URL as-is (never invent new ones; drop what doesn't fit). The "niche", "audience" and "summary" fields come from the notes' opening lines. One exception to as-is — the "listing" object is sales copy, not research: write each description as polished, benefit-first copy of 120-170 words, and if the notes are missing any listing field for a product (title, price, bullets), write it yourself from that product's facts in the notes (price consistent with the retail numbers given). Never add certifications, reviews, or statistics that aren't in the notes:\n${REPORT_SHAPE}`,
          },
          { role: "user", content: raw.slice(0, 24_000) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      log("warn", "hunt", "reformat_upstream_error", { status: res.status });
      return { content: null, capacity: res.status === 429 || res.status === 413 || res.status >= 500 };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { content: data.choices?.[0]?.message?.content ?? null, capacity: false };
  } catch (err) {
    log("warn", "hunt", "reformat_failed", { err: String(err) });
    return { content: null, capacity: true };
  }
}

/**
 * compound-mini occasionally falls into a repetition loop mid-notes
 * ("1000mAh-1000mAh-…" until the token cap). The healthy notes before the
 * loop are salvageable — cut at the first chunk repeated 8+ times in a row.
 */
export function trimDegenerateTail(raw: string): string {
  const m = raw.match(/(.{3,40}?)\1{7,}/s);
  return m && m.index !== undefined ? raw.slice(0, m.index) : raw;
}

// ---------------------------------------------------------------------------
// Parsing + sanitizing (never trust model JSON blindly)

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const safeUrl = (v: unknown): string | undefined => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) ? s : undefined;
};

/**
 * Sourcing links are rebuilt deterministically from supplier + search term —
 * the research model's marketplace deep-links routinely carry fabricated item
 * IDs (dead 404s), while a search URL always lands on live listings.
 */
const SUPPLIER_SEARCH: { match: RegExp; build: (term: string) => string }[] = [
  { match: /aliexpress/i, build: (t) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(t)}` },
  { match: /alibaba/i, build: (t) => `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(t)}` },
  { match: /faire/i, build: (t) => `https://www.faire.com/search?q=${encodeURIComponent(t)}` },
  { match: /amazon/i, build: (t) => `https://www.amazon.com/s?k=${encodeURIComponent(t)}` },
  { match: /etsy/i, build: (t) => `https://www.etsy.com/search?q=${encodeURIComponent(t)}` },
  { match: /temu/i, build: (t) => `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(t)}` },
];

function sourcingUrl(supplier: string, searchTerm: string): string | undefined {
  if (!searchTerm) return undefined;
  const entry = SUPPLIER_SEARCH.find((s) => s.match.test(supplier));
  return entry ? entry.build(searchTerm) : undefined;
}

function sanitizeReport(parsed: Record<string, unknown>, storeUrl: string): HuntReport | null {
  const rawProducts = Array.isArray(parsed.products) ? parsed.products : [];
  const products: HuntProduct[] = [];
  for (const raw of rawProducts.slice(0, 3)) {
    const p = raw as Record<string, unknown>;
    const listing = (p.listing ?? {}) as Record<string, unknown>;
    const name = str(p.name, 120);
    if (!name) continue;
    products.push({
      name,
      hook: str(p.hook, 200),
      whyWinning: str(p.whyWinning, 1000),
      stats: (Array.isArray(p.stats) ? p.stats : [])
        .slice(0, 5)
        .map((s) => ({ label: str((s as Record<string, unknown>).label, 60), value: str((s as Record<string, unknown>).value, 120) }))
        .filter((s) => s.label && s.value),
      sourcing: (Array.isArray(p.sourcing) ? p.sourcing : [])
        .slice(0, 3)
        .map((s) => {
          const src = s as Record<string, unknown>;
          const supplier = str(src.supplier, 60);
          const searchTerm = str(src.searchTerm, 120);
          return {
            supplier,
            searchTerm,
            url: sourcingUrl(supplier, searchTerm),
            unitCost: str(src.unitCost, 40) || undefined,
          };
        })
        .filter((s) => s.supplier),
      listing: {
        title: str(listing.title, 120),
        price: str(listing.price, 40),
        bullets: (Array.isArray(listing.bullets) ? listing.bullets : []).slice(0, 6).map((b) => str(b, 200)).filter(Boolean),
        description: str(listing.description, 2500),
      },
      fit: str(p.fit, 400),
      sources: (Array.isArray(p.sources) ? p.sources : [])
        .slice(0, 4)
        .map((s) => {
          const src = s as Record<string, unknown>;
          return { title: str(src.title, 120) || "source", url: safeUrl(src.url) ?? "" };
        })
        // A bare domain is not a citation — keep only links to actual pages.
        .filter((s) => {
          try {
            return s.url && new URL(s.url).pathname.length > 1;
          } catch {
            return false;
          }
        }),
    });
  }
  if (products.length === 0) return null;

  return {
    storeUrl,
    niche: str(parsed.niche, 200),
    audience: str(parsed.audience, 200),
    summary: str(parsed.summary, 800),
    products,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The research model sometimes cites placeholder URLs that never existed
 * (amazon.com/dp/B09XYZ). Probe every source link and drop the provably dead
 * ones (404/410/DNS failure); bot-walls (403 etc.) pass — the page exists.
 */
export async function verifySources(report: HuntReport): Promise<void> {
  const urls = [...new Set(report.products.flatMap((p) => p.sources.map((s) => s.url)))];
  const alive = new Map<string, boolean>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; EvolutionBot/1.0)" },
          redirect: "follow",
          signal: AbortSignal.timeout(4_000),
        });
        alive.set(url, res.status !== 404 && res.status !== 410);
      } catch {
        alive.set(url, false);
      }
    }),
  );
  for (const p of report.products) {
    p.sources = p.sources.filter((s) => alive.get(s.url) !== false);
  }
}

// ---------------------------------------------------------------------------
// Persistence (service role — mirrors persistAudit)

async function persistHunt(env: AuditEnv, report: HuntReport, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  try {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/product_hunts`, {
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
        niche: report.niche,
        report,
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) log("warn", "hunt", "persist_failed", { status: res.status });
  } catch (err) {
    log("warn", "hunt", "persist_unreachable", { err: String(err) });
    /* best-effort; the report already streamed to the client */
  }
}

// ---------------------------------------------------------------------------
// Core hunt (no auth / rate limit / persistence — the orchestrator adds those;
// exported separately so it can be exercised directly in tests)

export async function executeHunt(
  host: string,
  storeUrl: string,
  env: AuditEnv,
  progress: (text: string) => void,
): Promise<{ report: HuntReport | null; error: string | null }> {
  progress("Reading your catalog to pin down your niche…");
  const digest = await readCatalog(host);
  if (!digest) {
    return { report: null, error: "We couldn't read enough of that store to pin down its niche. Check the URL in My store and try again." };
  }

  // One retry: compound sometimes skips its search tool and refuses in a
  // sentence, or loops — a fresh call almost always recovers.
  let research = await researchCall(digest, env);
  let raw = research.content;
  if (raw) raw = trimDegenerateTail(raw);
  if (!raw && (research.failure === "auth" || research.failure === "rate_limit" || research.failure === "payload")) {
    return { report: null, error: researchFailureMessage(research.failure) };
  }
  if (!raw || raw.length < 900) {
    progress("First pass came back thin — hunting again…");
    research = await researchCall(digest, env);
    raw = research.content;
    if (raw) raw = trimDegenerateTail(raw);
  }
  if (!raw || raw.length < 300) {
    return { report: null, error: researchFailureMessage(research.failure) };
  }

  progress("Structuring the findings…");
  // Two attempts: a capacity blip (free-tier rate limit) or a one-off parse
  // miss shouldn't throw away a research pass that already succeeded.
  let capacityFail = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content, capacity } = await reformatCall(raw, env);
    capacityFail = capacity;
    const parsed = content ? extractJsonObject(content) : null;
    const report = parsed ? sanitizeReport(parsed, storeUrl) : null;
    if (report) {
      await verifySources(report);
      return { report, error: null };
    }
  }

  return {
    report: null,
    error: capacityFail
      ? "The research finished, but the report writer is at capacity this minute — give it about 60 seconds and run it again."
      : "The research came back malformed — run it again, it's usually a one-off.",
  };
}

// ---------------------------------------------------------------------------
// Orchestrator

export async function runProductHunt(
  body: { url?: unknown },
  authHeader: string | null,
  env: AuditEnv,
): Promise<Response> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResponse(401, { error: "Sign in to run the product hunt." });
  const userId = user.id;
  if (!env.groqKey) {
    return jsonResponse(503, { error: "The research engine isn't configured yet. Try again shortly." });
  }

  const normalized = normalizeStoreUrl(body.url);
  if ("error" in normalized) return jsonResponse(400, { error: normalized.error });

  // Founder/admin accounts iterate on the feature — no daily cap for them.
  const isAdmin = Boolean(
    user.email &&
      (env.adminEmails ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .includes(user.email.toLowerCase()),
  );

  const allowed =
    isAdmin || (await checkRateLimit(env, `hunt:u:${userId}`, 86_400, HUNT_LIMIT_USER_PER_DAY));
  if (!allowed) {
    log("warn", "hunt", "rate_limited", {});
    return jsonResponse(429, {
      error: `That's ${HUNT_LIMIT_USER_PER_DAY} hunts today — the market won't shift before tomorrow. Come back then.`,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const progress = (text: string) => controller.enqueue(sse({ progress: text }));

      // Staged status lines keep the founder informed (and the connection
      // visibly alive) through the 20-60s search pass.
      const stages = [
        "Hunting live trends in your niche — this takes a minute…",
        "Scanning marketplace best-seller lists…",
        "Reading search and social demand signals…",
        "Checking supplier listings for real unit costs…",
        "Writing your listings and sourcing plan…",
      ];
      let stageIdx = -1;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      try {
        // executeHunt sends its own first line ("Reading your catalog…");
        // the heartbeat then walks the staged research lines every 9s.
        heartbeat = setInterval(() => {
          if (stageIdx < stages.length - 1) progress(stages[++stageIdx]);
        }, 9_000);

        const { report, error } = await executeHunt(normalized.host, normalized.url, env, progress);
        if (heartbeat) clearInterval(heartbeat);
        if (!report) {
          controller.enqueue(sse({ error }));
          return;
        }

        await persistHunt(env, report, userId);
        log("info", "hunt", "completed", { products: report.products.length });
        controller.enqueue(sse({ report }));
      } catch (err) {
        log("error", "hunt", "crashed", { err: String(err) });
        controller.enqueue(sse({ error: "The hunt hit an unexpected error — try again in a minute." }));
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        controller.enqueue(sseDone);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
