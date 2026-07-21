/**
 * Tools the skill engine (_skills.ts) can run against a connected store.
 *
 * Design rule: the model narrates, the code counts. Every tool fetches via
 * the read-only Admin API token (service-role side — the browser never sees
 * it) and returns a compact JSON digest: computed flags, counts, and short
 * strings, never raw body_html and never customer PII (checkout emails etc.
 * stay out of model context and therefore out of the chat_messages log).
 *
 * `file_task` is the one write — into OUR tasks table (the human ops queue),
 * not into Shopify. It also pings the team via _email.ts, best-effort.
 */
import { shopifyGetDetailed, shopifyGraphql, type ShopifyConnection, type ShopifyEnv } from "./_shopify";
import { fetchOrdersWindow, fetchAbandonedCheckoutsWindow } from "./_shopifyData";
import { fetchOrderStats, stripHtml } from "./_audit";
import { sendTaskEmail, type EmailEnv } from "./_email";

/** Includes the Shopify app creds so getConnection can refresh tokens. */
export type SkillEnv = ShopifyEnv & EmailEnv;

export interface ToolCtx {
  env: SkillEnv;
  userId: string;
  userEmail: string | null;
  conn: ShopifyConnection | null;
  origin: string;
}

/** OpenAI/Groq function-calling tool shape. */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolDef {
  schema: ToolSchema;
  run(ctx: ToolCtx, args: Record<string, unknown>): Promise<unknown>;
}

const TASK_TOOL_VALUES = ["product", "marketing", "support", "retention", "operations", "analytics", "custom"];

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.round(v) : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
};

// ---------------------------------------------------------------------------
// Product digest

interface AdminVariant {
  price?: string;
  inventory_quantity?: number;
  inventory_management?: string | null;
  inventory_policy?: string;
}
interface AdminImage {
  alt?: string | null;
}
interface AdminProduct {
  id?: number;
  title?: string;
  handle?: string;
  status?: string;
  body_html?: string | null;
  tags?: string;
  images?: AdminImage[];
  variants?: AdminVariant[];
}

/** Provider-neutral product shape both fetch paths map into. */
interface ProductSource {
  title: string;
  status: string;
  descText: string;
  imageCount: number;
  imagesNoAlt: number;
  variants: { price: number | null; qty: number | null; tracked: boolean; oversells: boolean }[];
  tagCount: number;
}

/** Sold out = every variant tracked, at/under zero, and not set to oversell. */
function isSoldOut(p: ProductSource): boolean {
  if (p.variants.length === 0) return false;
  if (!p.variants.every((v) => v.tracked)) return false; // untracked = assume sellable
  return p.variants.every((v) => (v.qty ?? 0) <= 0 && !v.oversells);
}

/**
 * Primary product fetch: GraphQL Admin API. Shopify blocks the REST product
 * endpoints for newly created apps (legacy since 2025), so GraphQL is the
 * path that works for OUR app. Paginated at 25/page to stay well under the
 * query-cost ceiling; variants/media are sampled (first 10 each).
 */
const PRODUCTS_QUERY = `query ProductAudit($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title
      status
      descriptionHtml
      tags
      mediaCount { count }
      media(first: 10) { nodes { alt } }
      variants(first: 10) {
        nodes {
          price
          inventoryQuantity
          inventoryPolicy
          inventoryItem { tracked }
        }
      }
    }
  }
}`;

interface GqlProductsData {
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      title?: string;
      status?: string;
      descriptionHtml?: string | null;
      tags?: string[];
      mediaCount?: { count?: number } | null;
      media?: { nodes?: { alt?: string | null }[] };
      variants?: {
        nodes?: {
          price?: string;
          inventoryQuantity?: number | null;
          inventoryPolicy?: string;
          inventoryItem?: { tracked?: boolean } | null;
        }[];
      };
    }[];
  };
}

async function fetchProductsGraphql(conn: ShopifyConnection, limit: number): Promise<ProductSource[] | null> {
  const out: ProductSource[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4 && out.length < limit; page++) {
    const data: GqlProductsData | null = await shopifyGraphql<GqlProductsData>(
      conn.shop_domain,
      conn.access_token,
      PRODUCTS_QUERY,
      { first: Math.min(25, limit - out.length), after },
    );
    const productsPage: GqlProductsData["products"] = data?.products;
    if (!productsPage?.nodes) return page === 0 ? null : out; // partial > nothing
    for (const n of productsPage.nodes) {
      const media = n.media?.nodes ?? [];
      out.push({
        title: n.title ?? "(untitled)",
        status: (n.status ?? "ACTIVE").toLowerCase(),
        descText: stripHtml(n.descriptionHtml),
        imageCount: n.mediaCount?.count ?? media.length,
        imagesNoAlt: media.filter((m) => !(m.alt ?? "").trim()).length,
        variants: (n.variants?.nodes ?? []).map((v) => ({
          price: Number.isFinite(parseFloat(v.price ?? "")) ? parseFloat(v.price ?? "") : null,
          qty: v.inventoryQuantity ?? null,
          tracked: v.inventoryItem?.tracked ?? false,
          oversells: v.inventoryPolicy === "CONTINUE",
        })),
        tagCount: (n.tags ?? []).length,
      });
    }
    if (!productsPage.pageInfo?.hasNextPage || !productsPage.pageInfo.endCursor) break;
    after = productsPage.pageInfo.endCursor;
  }
  return out;
}

/** REST fallback for older apps where products.json still works. */
async function fetchProductsRest(
  conn: ShopifyConnection,
  limit: number,
): Promise<{ items: ProductSource[] | null; status: number }> {
  const { status, data } = await shopifyGetDetailed<{ products?: AdminProduct[] }>(
    conn.shop_domain,
    conn.access_token,
    `products.json?limit=${limit}&fields=id,title,handle,status,body_html,tags,images,variants`,
  );
  if (!data?.products) return { items: null, status };
  return {
    status,
    items: data.products.map((p) => ({
      title: p.title ?? "(untitled)",
      status: p.status ?? "active",
      descText: stripHtml(p.body_html),
      imageCount: (p.images ?? []).length,
      imagesNoAlt: (p.images ?? []).filter((i) => !(i.alt ?? "").trim()).length,
      variants: (p.variants ?? []).map((v) => ({
        price: Number.isFinite(parseFloat(v.price ?? "")) ? parseFloat(v.price ?? "") : null,
        qty: v.inventory_quantity ?? null,
        tracked: Boolean(v.inventory_management),
        oversells: v.inventory_policy === "continue",
      })),
      tagCount: (p.tags ?? "").split(",").filter((t) => t.trim()).length,
    })),
  };
}

export async function buildProductsDigest(
  conn: ShopifyConnection,
  limit: number,
): Promise<{ products: unknown[]; aggregate: Record<string, unknown> } | { error: string }> {
  let sources = await fetchProductsGraphql(conn, limit);
  if (!sources) {
    const rest = await fetchProductsRest(conn, limit);
    if (!rest.items) {
      const why =
        rest.status === 401 || rest.status === 403
          ? `Shopify rejected the store's access token (HTTP ${rest.status}). Shopify retired old-style tokens, so hit "Reconnect" next to your store in the Tasks panel and this will work again`
          : rest.status > 0
            ? `Shopify answered with HTTP ${rest.status}`
            : "Shopify didn't answer in time";
      return { error: `Couldn't fetch the store's products — ${why}.` };
    }
    sources = rest.items;
  }

  const products = sources.slice(0, limit).map((p) => {
    const prices = p.variants.map((v) => v.price).filter((n): n is number => n !== null);
    return {
      title: p.title.slice(0, 60),
      status: p.status,
      descChars: p.descText.length,
      descQuality: p.descText.length === 0 ? "missing" : p.descText.length < 200 ? "thin" : "ok",
      images: p.imageCount,
      imagesNoAlt: p.imagesNoAlt,
      soldOut: isSoldOut(p),
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      tags: p.tagCount,
    };
  });

  const titles = products.map((p) => p.title.toLowerCase());
  const duplicateTitles = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))].slice(0, 5);
  const avg = (ns: number[]) => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0);

  return {
    products,
    aggregate: {
      total: products.length,
      truncated: products.length >= limit,
      active: products.filter((p) => p.status === "active").length,
      descMissing: products.filter((p) => p.descQuality === "missing").length,
      descThin: products.filter((p) => p.descQuality === "thin").length,
      avgDescChars: avg(products.map((p) => p.descChars)),
      noImages: products.filter((p) => p.images === 0).length,
      withImagesMissingAlt: products.filter((p) => p.imagesNoAlt > 0).length,
      soldOut: products.filter((p) => p.soldOut).length,
      duplicateTitles,
    },
  };
}

// ---------------------------------------------------------------------------
// The registry

export const SKILL_TOOLS: Record<string, ToolDef> = {
  get_products: {
    schema: {
      type: "function",
      function: {
        name: "get_products",
        description:
          "Fetch the store's products from the Shopify Admin API and return a per-product analysis digest (description quality, images, alt text, stock, prices) plus aggregate stats.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
          },
        },
      },
    },
    async run(ctx, args) {
      if (!ctx.conn) return { error: "No Shopify store connected." };
      return buildProductsDigest(ctx.conn, clampInt(args.limit, 1, 100, 100));
    },
  },

  get_product_sales: {
    schema: {
      type: "function",
      function: {
        name: "get_product_sales",
        description:
          "Per-product sales for the last N days, computed from real order line items: top sellers ranked by units (with revenue), and how many distinct products sold at all. Use for 'top/best selling product', 'how many did X sell', 'what's not selling'.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "integer", minimum: 7, maximum: 90, default: 30 },
          },
        },
      },
    },
    async run(ctx, args) {
      if (!ctx.conn) return { error: "No Shopify store connected." };
      const days = clampInt(args.days, 7, 90, 30);
      const orders = await fetchOrdersWindow(ctx.conn, days, { lineItems: true });
      if (!orders) return { error: "Couldn't reach the Shopify orders API." };
      const byTitle = new Map<string, { units: number; revenue: number }>();
      for (const order of orders) {
        for (const li of order.lineItems) {
          const cur = byTitle.get(li.title) ?? { units: 0, revenue: 0 };
          cur.units += li.quantity;
          cur.revenue += li.price * li.quantity;
          byTitle.set(li.title, cur);
        }
      }
      const ranked = [...byTitle.entries()].sort((a, b) => b[1].units - a[1].units);
      return {
        windowDays: days,
        ordersCounted: orders.length,
        bestsellers: ranked.slice(0, 10).map(([title, s]) => ({
          title,
          units: s.units,
          revenue: Math.round(s.revenue),
        })),
        distinctProductsSold: byTitle.size,
        note:
          orders.length >= 250
            ? "capped at the first 250 orders"
            : byTitle.size === 0
              ? "no orders in this window"
              : undefined,
      };
    },
  },

  get_orders_summary: {
    schema: {
      type: "function",
      function: {
        name: "get_orders_summary",
        description:
          "Order stats for the last N days: order count, revenue, AOV, unique customers, repeat-purchase rate, and weekly buckets.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "integer", minimum: 7, maximum: 90, default: 30 },
          },
        },
      },
    },
    async run(ctx, args) {
      if (!ctx.conn) return { error: "No Shopify store connected." };
      const stats = await fetchOrderStats(ctx.conn, clampInt(args.days, 7, 90, 30));
      if (!stats.fetched) return { error: "Couldn't reach the Shopify orders API." };
      return {
        ...stats,
        revenue: Math.round(stats.revenue),
        aov: stats.aov === null ? null : Math.round(stats.aov),
        repeatRate: stats.repeatRate === null ? null : Math.round(stats.repeatRate * 100) / 100,
        note: stats.orders >= 250 ? "capped at the first 250 orders" : undefined,
      };
    },
  },

  get_abandoned_checkouts: {
    schema: {
      type: "function",
      function: {
        name: "get_abandoned_checkouts",
        description:
          "Abandoned checkout stats for the last N days: count, total and average value, and how many left an email (recoverable). No customer PII is returned.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "integer", minimum: 7, maximum: 90, default: 30 },
          },
        },
      },
    },
    async run(ctx, args) {
      if (!ctx.conn) return { error: "No Shopify store connected." };
      const days = clampInt(args.days, 7, 90, 30);
      const checkouts = await fetchAbandonedCheckoutsWindow(ctx.conn, days);
      if (!checkouts) return { error: "Couldn't reach the Shopify checkouts API." };
      const total = checkouts.reduce((a, c) => a + c.totalPrice, 0);
      return {
        days,
        count: checkouts.length,
        totalValue: Math.round(total),
        avgValue: checkouts.length ? Math.round(total / checkouts.length) : 0,
        withEmailCount: checkouts.filter((c) => c.hasEmail).length,
        recent: checkouts.slice(0, 10).map((c) => ({
          createdAt: c.createdAt.slice(0, 10),
          value: Math.round(c.totalPrice),
          itemCount: c.itemCount,
        })),
        note: checkouts.length >= 250 ? "capped at the first 250 checkouts" : undefined,
      };
    },
  },

  get_latest_audit: {
    schema: {
      type: "function",
      function: {
        name: "get_latest_audit",
        description: "The store's most recent Evolution audit: score, summary, findings, and how old it is.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run(ctx) {
      const { env } = ctx;
      if (!env.supabaseUrl || !env.serviceRoleKey) return { error: "No audit storage configured." };
      try {
        const res = await fetch(
          `${env.supabaseUrl}/rest/v1/audits?user_id=eq.${ctx.userId}&order=created_at.desc&limit=1&select=report,created_at`,
          {
            headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
            signal: AbortSignal.timeout(4_000),
          },
        );
        if (!res.ok) return { error: "Couldn't load the audit." };
        const rows = (await res.json()) as {
          report?: {
            score?: number;
            summary?: string;
            findings?: { title?: string; detail?: string }[];
            stats?: unknown;
          };
          created_at?: string;
        }[];
        const row = rows[0];
        if (!row?.report) return { error: "No audit on file yet — run one from the store panel." };
        const ageDays = Math.round((Date.now() - Date.parse(row.created_at ?? "")) / 86_400_000);
        return {
          score: row.report.score ?? null,
          summary: row.report.summary ?? "",
          findings: (row.report.findings ?? []).map((f) => ({ title: f.title, detail: f.detail })),
          stats: row.report.stats ?? null,
          ageDays: Number.isFinite(ageDays) ? ageDays : null,
        };
      } catch {
        return { error: "Couldn't load the audit." };
      }
    },
  },

  file_task: {
    schema: {
      type: "function",
      function: {
        name: "file_task",
        description:
          "File a task with Evolution's human team when the founder wants changes made (rewriting listings, setting up flows, anything hands-on). Use only after the founder confirms.",
        parameters: {
          type: "object",
          properties: {
            tool: { type: "string", enum: TASK_TOOL_VALUES },
            request: { type: "string", description: "What the founder wants done, specific and self-contained." },
          },
          required: ["tool", "request"],
        },
      },
    },
    async run(ctx, args) {
      const tool = TASK_TOOL_VALUES.includes(String(args.tool)) ? String(args.tool) : "custom";
      const request = String(args.request ?? "").slice(0, 4_000).trim();
      if (!request) return { ok: false, error: "Empty request." };
      const taskId = await insertTask(ctx, tool, request);
      if (!taskId) return { ok: false, error: "Couldn't file the task — ask the founder to use the Tasks panel." };
      void sendTaskEmail(ctx.env, {
        userEmail: ctx.userEmail,
        shopDomain: ctx.conn?.shop_domain ?? null,
        tool,
        request,
        taskId,
        origin: ctx.origin,
      });
      return { ok: true, taskId };
    },
  },
};

/** Service-role insert into the ops queue; user_id always from the resolved bearer. */
async function insertTask(ctx: ToolCtx, tool: string, request: string): Promise<string | null> {
  const { env } = ctx;
  if (!env.supabaseUrl || !env.serviceRoleKey) return null;
  try {
    const headers = {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    // Attach the visible store row when one exists (nullable column).
    let storeId: string | null = null;
    const storeRes = await fetch(
      `${env.supabaseUrl}/rest/v1/stores?user_id=eq.${ctx.userId}&select=id&limit=1`,
      { headers, signal: AbortSignal.timeout(4_000) },
    ).catch(() => null);
    if (storeRes?.ok) {
      const rows = (await storeRes.json()) as { id?: string }[];
      storeId = rows[0]?.id ?? null;
    }
    const res = await fetch(`${env.supabaseUrl}/rest/v1/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: ctx.userId, store_id: storeId, tool, request, status: "new" }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { id?: string }[];
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
