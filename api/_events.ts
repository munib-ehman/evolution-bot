/**
 * Live store events — the push half of the Operations Center.
 *
 * Two engines, shared by the edge handlers and dev-api.ts:
 *   handleShopifyWebhook — receives Shopify webhooks (HMAC-verified with the
 *       app secret), maps them to store_events rows inserted via the service
 *       role. Supabase Realtime streams the insert to the owner's browser —
 *       that's the WebSocket leg; Vercel functions never hold a socket.
 *       orders/create additionally triggers an instant inventory check on the
 *       ordered products, so "sold out"/"low stock" events fire the moment an
 *       order empties a shelf (no read_inventory scope or extra topic needed).
 *   runOpsLiveSetup — answers whether the live push works for the signed-in
 *       owner (webhook subscriptions are app-level, declared in
 *       shopify.app.toml — nothing to register per shop). Called by the Ops
 *       panel on open; local dev has no https origin so it reports live:false.
 *
 * Events are metadata only (order number, product titles, amounts) — no
 * customer PII is ever written to store_events.
 */
import { resolveUserFull } from "./_audit";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { fetchInventoryWatch } from "./_shopifyData";
import { log } from "./_log";

function jsonResult(status: number, body: Record<string, unknown>) {
  return { status, body };
}

const encoder = new TextEncoder();

/** Shopify webhook signature: base64 HMAC-SHA256 of the RAW body, app secret. */
export async function verifyWebhookHmac(
  secret: string,
  rawBody: string,
  headerB64: string | null,
): Promise<boolean> {
  if (!secret || !headerB64) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== headerB64.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerB64.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// store_events writes (service role — the browser only ever reads)

interface StoreEventInsert {
  user_id: string;
  type: string;
  title: string;
  detail: Record<string, unknown>;
}

async function insertEvents(env: ShopifyEnv, rows: StoreEventInsert[]): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey || rows.length === 0) return;
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/store_events`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    /* webhook must still 200 — a lost event is better than a retry storm */
    log("warn", "webhook", "event_insert_failed", { userId: rows[0]?.user_id, count: rows.length });
  }
}

/** Was this exact stock event already raised in the last 24h? (anti-spam) */
async function recentStockEventExists(
  env: ShopifyEnv,
  userId: string,
  type: string,
  product: string,
): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return false;
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      select: "id",
      user_id: `eq.${userId}`,
      type: `eq.${type}`,
      created_at: `gte.${since}`,
      limit: "1",
    });
    params.append("detail->>product", `eq.${product}`);
    const res = await fetch(`${env.supabaseUrl}/rest/v1/store_events?${params.toString()}`, {
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/shopify-webhook

interface OrderWebhookPayload {
  name?: string;
  order_number?: number;
  total_price?: string;
  currency?: string;
  line_items?: { title?: string; quantity?: number }[];
}

export async function lookupUserByShop(env: ShopifyEnv, shop: string): Promise<string | null> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return null;
  try {
    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/shopify_connections?shop_domain=eq.${encodeURIComponent(shop)}&select=user_id`,
      {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { user_id?: string }[];
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify + route one Shopify webhook. Always answers 200 after a valid
 * signature (Shopify retries non-2xx for 48h — our internal hiccups must not
 * cause a retry storm); 401 only for a bad/missing signature.
 */
export async function handleShopifyWebhook(
  rawBody: string,
  headers: { topic: string | null; shop: string | null; hmac: string | null },
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ok = await verifyWebhookHmac(env.shopifyApiSecret ?? "", rawBody, headers.hmac);
  if (!ok) {
    log("warn", "webhook", "hmac_rejected", { topic: headers.topic, shop: headers.shop });
    return jsonResult(401, { error: "Invalid webhook signature." });
  }

  const shop = (headers.shop ?? "").trim().toLowerCase();
  const userId = shop ? await lookupUserByShop(env, shop) : null;
  if (!userId) return jsonResult(200, { ok: true }); // store no longer connected

  if (headers.topic === "app/uninstalled") {
    await handleAppUninstalled(env, shop, userId);
    return jsonResult(200, { ok: true });
  }

  if (headers.topic === "app_subscriptions/update") {
    await handleSubscriptionUpdate(env, rawBody, userId);
    return jsonResult(200, { ok: true });
  }

  if (headers.topic === "orders/create") {
    let payload: OrderWebhookPayload = {};
    try {
      payload = JSON.parse(rawBody) as OrderWebhookPayload;
    } catch {
      return jsonResult(200, { ok: true });
    }
    const orderName = payload.name ?? (payload.order_number != null ? `#${payload.order_number}` : "");
    const total = parseFloat(payload.total_price ?? "0") || 0;
    const items = (payload.line_items ?? []).map((li) => ({
      title: (li.title ?? "").trim() || "(untitled)",
      qty: li.quantity ?? 0,
    }));
    const itemsLine = items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title)).join(", ");

    await insertEvents(env, [
      {
        user_id: userId,
        type: "order.new",
        title: `New order ${orderName || ""} — ${payload.currency ?? ""} ${Math.round(total * 100) / 100}`.trim(),
        detail: { order: orderName, total, currency: payload.currency ?? null, items: itemsLine },
      },
    ]);

    // The order may have just emptied a shelf — check the ordered products.
    const conn = await getConnection(env, userId);
    if (conn) {
      const inventory = await fetchInventoryWatch(conn);
      if (inventory) {
        const orderedTitles = new Set(items.map((i) => i.title));
        const stockEvents: StoreEventInsert[] = [];
        for (const p of inventory) {
          if (!orderedTitles.has(p.title)) continue;
          if (p.soldOut && !(await recentStockEventExists(env, userId, "stock.out", p.title))) {
            stockEvents.push({
              user_id: userId,
              type: "stock.out",
              title: `Sold out: ${p.title}`,
              detail: { product: p.title },
            });
          } else if (p.lowStock && !(await recentStockEventExists(env, userId, "stock.low", p.title))) {
            stockEvents.push({
              user_id: userId,
              type: "stock.low",
              title: `Low stock: ${p.title} — ${p.totalInventory} left`,
              detail: { product: p.title, left: p.totalInventory },
            });
          }
        }
        await insertEvents(env, stockEvents);
      }
    }
  }

  return jsonResult(200, { ok: true });
}

/**
 * app/uninstalled — TOMBSTONE, don't delete. Shopify revoked the token the
 * moment the merchant uninstalled, so we null our copy and stamp
 * uninstalled_at, but keep the row: shop/redact arrives up to 48h later and
 * needs the shop_domain → user_id mapping to know whose data to erase
 * (see api/_compliance.ts). The visible stores row goes away so the app
 * shows "not connected", and a Shopify-billed plan drops back to free.
 */
async function handleAppUninstalled(env: ShopifyEnv, shop: string, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const patchConn = fetch(
    `${env.supabaseUrl}/rest/v1/shopify_connections?shop_domain=eq.${encodeURIComponent(shop)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        refresh_token_expires_at: null,
        uninstalled_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(6_000),
    },
  );
  const dropStore = fetch(`${env.supabaseUrl}/rest/v1/stores?user_id=eq.${userId}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(6_000),
  });
  // Only Shopify-billed plans are Shopify's to take away.
  const downgrade = fetch(
    `${env.supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&plan_source=eq.shopify`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ plan: "free" }),
      signal: AbortSignal.timeout(6_000),
    },
  );
  const steps = ["tombstone_connection", "drop_store", "downgrade_plan"];
  await Promise.all(
    [patchConn, dropStore, downgrade].map((p, i) =>
      p.catch(() => log("warn", "webhook", "uninstall_step_failed", { shop, step: steps[i] })),
    ),
  );
}

/**
 * app_subscriptions/update — sync Shopify App Pricing state to profiles.plan.
 * ACTIVE claims the plan for Shopify billing; anything else (CANCELLED,
 * DECLINED, EXPIRED, FROZEN…) releases it — but ONLY for rows Shopify billing
 * owns, so a manually- or Paddle-upgraded account can never be downgraded by
 * a stray Shopify webhook.
 */
async function handleSubscriptionUpdate(env: ShopifyEnv, rawBody: string, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  let status = "";
  try {
    const payload = JSON.parse(rawBody) as { app_subscription?: { status?: string } };
    status = (payload.app_subscription?.status ?? "").toUpperCase();
  } catch {
    return;
  }
  if (!status) return;

  const active = status === "ACTIVE";
  const filter = active
    ? `user_id=eq.${userId}`
    : `user_id=eq.${userId}&plan_source=eq.shopify`;
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?${filter}`, {
      method: "PATCH",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(active ? { plan: "operator", plan_source: "shopify" } : { plan: "free" }),
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    /* webhook must still 200 — the next session-token exchange re-syncs */
    log("warn", "webhook", "plan_sync_failed", { userId, status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/ops-live — is the live push available for this owner?
//
// Webhook subscriptions are APP-LEVEL now, declared in shopify.app.toml and
// delivered for every install by Shopify itself (`shopify app deploy` pushes
// them) — nothing to register per shop anymore. This endpoint just answers
// whether the push leg can work: signed in, store connected, https origin
// (Shopify can't call a localhost webhook, so local dev polls instead).

export async function runOpsLiveSetup(
  authHeader: string | null,
  origin: string,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  if (!origin.startsWith("https://")) {
    return jsonResult(200, {
      live: false,
      reason: "Live push needs the deployed app — local dev falls back to 60s refresh.",
    });
  }
  return jsonResult(200, { live: true });
}
