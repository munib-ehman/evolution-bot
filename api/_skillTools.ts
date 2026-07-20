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
import { shopifyGet, type ShopifyConnection } from "./_shopify";
import { fetchOrderStats, stripHtml, type AuditEnv } from "./_audit";
import { sendTaskEmail, type EmailEnv } from "./_email";

export type SkillEnv = AuditEnv & EmailEnv;

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

/** Admin API has no `available` flag: sold out = tracked, empty, no oversell. */
function isSoldOut(p: AdminProduct): boolean {
  const variants = p.variants ?? [];
  if (variants.length === 0) return false;
  const tracked = variants.filter((v) => v.inventory_management);
  if (tracked.length !== variants.length) return false; // untracked = assume sellable
  return tracked.every((v) => (v.inventory_quantity ?? 0) <= 0 && v.inventory_policy !== "continue");
}

export async function buildProductsDigest(conn: ShopifyConnection, limit: number) {
  const res = await shopifyGet<{ products?: AdminProduct[] }>(
    conn.shop_domain,
    conn.access_token,
    `products.json?limit=${limit}&fields=id,title,handle,status,body_html,tags,images,variants`,
  );
  if (!res?.products) return null;

  const products = res.products.map((p) => {
    const desc = stripHtml(p.body_html);
    const images = p.images ?? [];
    const prices = (p.variants ?? [])
      .map((v) => parseFloat(v.price ?? ""))
      .filter((n) => Number.isFinite(n));
    return {
      title: (p.title ?? "(untitled)").slice(0, 60),
      status: p.status ?? "active",
      descChars: desc.length,
      descQuality: desc.length === 0 ? "missing" : desc.length < 200 ? "thin" : "ok",
      images: images.length,
      imagesNoAlt: images.filter((i) => !(i.alt ?? "").trim()).length,
      soldOut: isSoldOut(p),
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      tags: (p.tags ?? "").split(",").filter((t) => t.trim()).length,
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
      const digest = await buildProductsDigest(ctx.conn, clampInt(args.limit, 1, 100, 100));
      return digest ?? { error: "Couldn't reach the Shopify products API." };
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
      const since = encodeURIComponent(new Date(Date.now() - days * 24 * 3600 * 1000).toISOString());
      const res = await shopifyGet<{
        checkouts?: { total_price?: string; created_at?: string; email?: string; line_items?: unknown[] }[];
      }>(ctx.conn.shop_domain, ctx.conn.access_token, `checkouts.json?limit=250&created_at_min=${since}`);
      if (!res?.checkouts) return { error: "Couldn't reach the Shopify checkouts API." };
      const checkouts = res.checkouts;
      const values = checkouts.map((c) => parseFloat(c.total_price ?? "0") || 0);
      const total = values.reduce((a, b) => a + b, 0);
      return {
        days,
        count: checkouts.length,
        totalValue: Math.round(total),
        avgValue: checkouts.length ? Math.round(total / checkouts.length) : 0,
        withEmailCount: checkouts.filter((c) => (c.email ?? "").includes("@")).length,
        recent: checkouts.slice(0, 10).map((c) => ({
          createdAt: (c.created_at ?? "").slice(0, 10),
          value: Math.round(parseFloat(c.total_price ?? "0") || 0),
          itemCount: c.line_items?.length ?? 0,
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
