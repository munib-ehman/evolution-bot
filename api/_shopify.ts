/**
 * Shopify OAuth + Admin API — shared by /api/shopify-auth, /api/shopify-callback
 * and the audit engine (files starting with "_" in api/ are helpers, not
 * endpoints).
 *
 * Flow: the signed-in owner asks to connect → shopify-auth verifies their
 * Supabase token, signs a state nonce, and returns Shopify's authorize URL →
 * the owner approves read-only scopes on Shopify → shopify-callback verifies
 * Shopify's HMAC + our state, swaps the code for an access token, and stores
 * it in shopify_connections via the service role. The token NEVER reaches
 * the browser (the table's column grants exclude it), and the app only ever
 * asks for read scopes — Evolution can look, not touch.
 */
import { resolveUser, type AuditEnv } from "./_audit";
import { migratePolarToShopify, type PolarMigrateEnv } from "./_polarMigrate";
import { log } from "./_log";

export const SHOPIFY_API_VERSION = "2026-04";
export const SHOPIFY_SCOPES_DEFAULT = "read_products,read_orders,read_checkouts,read_customers";
/** OAuth states older than this are refused (stops replayed links). */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export interface ShopifyEnv extends AuditEnv {
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  shopifyScopes?: string;
}

export interface ShopifyConnection {
  shop_domain: string;
  access_token: string;
  /** Expiring-token fields (null on legacy rows, which Shopify now rejects). */
  refresh_token?: string | null;
  token_expires_at?: string | null;
}

/** Env bundle for the deployed edge functions (dev-api builds its own via loadEnv). */
export function shopifyEnvFromProcess(): ShopifyEnv {
  return {
    groqKey: (process.env.GROQ_API_KEY ?? "").trim(),
    groqModel: (process.env.GROQ_CHAT_MODEL ?? "").trim(),
    groqResearchModel: (process.env.GROQ_RESEARCH_MODEL ?? "").trim(),
    adminEmails: (process.env.ADMIN_EMAILS ?? "").trim(),
    supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    shopifyApiKey: (process.env.SHOPIFY_API_KEY ?? "").trim(),
    shopifyApiSecret: (process.env.SHOPIFY_API_SECRET ?? "").trim(),
    shopifyScopes: (process.env.SHOPIFY_SCOPES ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Small crypto helpers (WebCrypto — works on Vercel Edge and Node 18+)

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish hex comparison (length leak is fine — lengths are fixed). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Shop domain + OAuth message verification

/**
 * Accepts "mystore", "mystore.myshopify.com", or a pasted admin URL and
 * returns the canonical *.myshopify.com domain, or null. Strict shape —
 * this string gets interpolated into URLs we then fetch.
 */
export function normalizeShopDomain(raw: unknown): string | null {
  let s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

/** Shopify's OAuth HMAC: sorted `k=v` pairs joined with `&`, HMAC-SHA256 hex. */
export async function verifyShopifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = params.get("hmac") ?? "";
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(await hmacHex(secret, message), hmac.toLowerCase());
}

/** Our own CSRF state: `ts.userId.sig`, bound to the shop it was issued for. */
export async function makeState(userId: string, shop: string, secret: string): Promise<string> {
  const ts = Date.now().toString();
  const sig = await hmacHex(secret, `${ts}|${userId}|${shop}`);
  return `${ts}.${userId}.${sig}`;
}

/** Returns the userId baked into a valid, fresh, shop-bound state — else null. */
export async function verifyState(state: string, shop: string, secret: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [ts, userId, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) return null;
  const expected = await hmacHex(secret, `${ts}|${userId}|${shop}`);
  return safeEqual(expected, sig) ? userId : null;
}

// ---------------------------------------------------------------------------
// The two OAuth steps, shaped for thin edge/dev shells

/**
 * Step 1 — POST { shop } with the owner's Supabase bearer token.
 * Returns Shopify's authorize URL for the client to navigate to.
 */
export async function runShopifyAuthStart(
  shopRaw: unknown,
  authHeader: string | null,
  origin: string,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.shopifyApiKey || !env.shopifyApiSecret) {
    return { status: 503, body: { error: "Shopify connect isn't configured yet — email us and we'll set it up." } };
  }
  const shop = normalizeShopDomain(shopRaw);
  if (!shop) {
    return { status: 400, body: { error: "Enter your .myshopify.com domain (find it in your Shopify admin URL)." } };
  }
  const userId = await resolveUser(env, authHeader);
  if (!userId) return { status: 401, body: { error: "Sign in first." } };

  const state = await makeState(userId, shop, env.shopifyApiSecret);
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", env.shopifyApiKey);
  url.searchParams.set("scope", env.shopifyScopes || SHOPIFY_SCOPES_DEFAULT);
  url.searchParams.set("redirect_uri", `${origin}/api/shopify-callback`);
  url.searchParams.set("state", state);
  return { status: 200, body: { url: url.toString() } };
}

/**
 * Step 2 — Shopify redirects back with code+hmac+state. Verify everything,
 * swap the code for a token, persist, and tell the caller where to redirect.
 */
export async function runShopifyCallback(
  requestUrl: URL,
  env: ShopifyEnv,
  polarEnv?: PolarMigrateEnv,
): Promise<{ redirect: string }> {
  const fail = (reason: string) => {
    log("warn", "shopify-callback", "oauth_callback_failed", {
      reason,
      shop: requestUrl.searchParams.get("shop"),
    });
    return { redirect: `/app?shopify=error&reason=${encodeURIComponent(reason)}` };
  };
  if (!env.shopifyApiKey || !env.shopifyApiSecret) return fail("not-configured");

  const params = requestUrl.searchParams;
  const shop = normalizeShopDomain(params.get("shop"));
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  if (!shop || !code || !state) return fail("missing-params");

  if (!(await verifyShopifyHmac(params, env.shopifyApiSecret))) return fail("bad-hmac");
  const userId = await verifyState(state, shop, env.shopifyApiSecret);
  if (!userId) return fail("bad-state");

  // Swap the grant code for an EXPIRING offline token (expiring=1). Shopify
  // rejects the old non-expiring kind outright now; the ~24h access token is
  // auto-refreshed in getConnection() with the rotating 90-day refresh token.
  let token = "";
  let scopes = "";
  let refreshToken: string | null = null;
  let tokenExpiresAt: string | null = null;
  let refreshExpiresAt: string | null = null;
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.shopifyApiKey,
        client_secret: env.shopifyApiSecret,
        code,
        expiring: "1",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return fail("token-exchange");
    const data = (await res.json()) as {
      access_token?: string;
      scope?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };
    token = data.access_token ?? "";
    scopes = data.scope ?? "";
    refreshToken = data.refresh_token ?? null;
    tokenExpiresAt = expiryIso(data.expires_in);
    refreshExpiresAt = expiryIso(data.refresh_token_expires_in);
  } catch {
    return fail("token-exchange");
  }
  if (!token) return fail("token-exchange");

  if (!env.supabaseUrl || !env.serviceRoleKey) return fail("no-db");
  const saved = await saveConnection(env, userId, shop, {
    access_token: token,
    scopes,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
  });
  if (!saved) return fail("save");

  // Connected accounts bill through Shopify App Pricing from here on — wind
  // down any Polar subscription at period end (they keep what they paid for).
  if (polarEnv) await migratePolarToShopify(polarEnv, userId);

  return { redirect: "/app?shopify=connected" };
}

/**
 * Persist a fresh connection for a user + shop, releasing the shop from any
 * OTHER user first (shop_domain is UNIQUE — one store, one account; ownership
 * follows the latest install, e.g. a store transferred to a new owner who
 * reinstalls). Clears any uninstall tombstone. Also upserts the visible
 * stores row so the app knows a store is connected. Used by both OAuth
 * callback (standalone) and token exchange (embedded).
 */
export async function saveConnection(
  env: ShopifyEnv,
  userId: string,
  shop: string,
  fields: {
    access_token: string;
    scopes: string;
    refresh_token: string | null;
    token_expires_at: string | null;
    refresh_token_expires_at: string | null;
  },
): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return false;
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
  try {
    // Release the shop from any other user (their stores row too), or the
    // UNIQUE(shop_domain) constraint would reject the upsert below.
    const others = await fetch(
      `${env.supabaseUrl}/rest/v1/shopify_connections?shop_domain=eq.${encodeURIComponent(shop)}&user_id=neq.${userId}&select=user_id`,
      { headers, signal: AbortSignal.timeout(4_000) },
    );
    if (others.ok) {
      const rows = (await others.json()) as { user_id?: string }[];
      for (const row of rows) {
        if (!row.user_id) continue;
        await Promise.all([
          fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?user_id=eq.${row.user_id}`, {
            method: "DELETE",
            headers,
            signal: AbortSignal.timeout(6_000),
          }),
          fetch(`${env.supabaseUrl}/rest/v1/stores?user_id=eq.${row.user_id}`, {
            method: "DELETE",
            headers,
            signal: AbortSignal.timeout(6_000),
          }),
        ]);
      }
    }

    // The token row (service-role-only table — the browser never sees it)…
    const conn = await fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?on_conflict=user_id`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: userId,
        shop_domain: shop,
        ...fields,
        uninstalled_at: null,
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!conn.ok) return false;
    // …and the visible store row, so the app knows a store is connected.
    await fetch(`${env.supabaseUrl}/rest/v1/stores?on_conflict=user_id`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: userId, url: `https://${shop}`, platform: "shopify" }),
      signal: AbortSignal.timeout(6_000),
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin API access for the deep audit + skills

const expiryIso = (seconds: number | undefined): string | null =>
  typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;

/** Refresh when the access token has less runway than this. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * The stored connection for a user, or null. Service role only. When the
 * access token is expired (or close), it's refreshed in place with the
 * rotating refresh token — callers always get the freshest token we can
 * produce. Legacy non-expiring rows (no refresh_token) are returned as-is;
 * Shopify 403s them and the UI tells the owner to reconnect.
 */
export async function getConnection(env: ShopifyEnv, userId: string): Promise<ShopifyConnection | null> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return null;
  let conn: ShopifyConnection | null = null;
  try {
    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/shopify_connections?user_id=eq.${userId}&select=shop_domain,access_token,refresh_token,token_expires_at`,
      {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as ShopifyConnection[];
    conn = rows[0] ?? null;
  } catch {
    return null;
  }
  // Tombstoned rows (app/uninstalled nulled the token but kept the
  // shop→user mapping for GDPR webhooks) read as "not connected".
  if (!conn || !conn.access_token) return null;

  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : NaN;
  const needsRefresh = Number.isFinite(expMs) && expMs - Date.now() < TOKEN_REFRESH_MARGIN_MS;
  if (needsRefresh && conn.refresh_token && env.shopifyApiKey && env.shopifyApiSecret) {
    const refreshed = await refreshConnection(env, userId, conn);
    if (refreshed) return refreshed;
  }
  return conn;
}

/** Rotate the access token (and refresh token — Shopify issues a new one). */
async function refreshConnection(
  env: ShopifyEnv,
  userId: string,
  conn: ShopifyConnection,
): Promise<ShopifyConnection | null> {
  try {
    const res = await fetch(`https://${conn.shop_domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.shopifyApiKey,
        client_secret: env.shopifyApiSecret,
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      log("error", "shopify", "token_refresh_failed", { shop: conn.shop_domain, status: res.status });
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };
    if (!data.access_token) {
      log("error", "shopify", "token_refresh_failed", { shop: conn.shop_domain, reason: "no-token" });
      return null;
    }

    const fresh: ShopifyConnection = {
      shop_domain: conn.shop_domain,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? conn.refresh_token,
      token_expires_at: expiryIso(data.expires_in),
    };
    await fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: {
        apikey: env.serviceRoleKey!,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token,
        token_expires_at: fresh.token_expires_at,
        refresh_token_expires_at: expiryIso(data.refresh_token_expires_in),
      }),
      signal: AbortSignal.timeout(6_000),
    }).catch(() => {
      log("warn", "shopify", "token_persist_failed", { shop: conn.shop_domain });
    });
    return fresh;
  } catch {
    log("error", "shopify", "token_refresh_failed", { shop: conn.shop_domain, reason: "network" });
    return null;
  }
}

/**
 * Sever the store: delete the owner's Shopify connection (the token row) and
 * their stores row, so they can connect a different store from scratch.
 * Service-role deletes — the browser has no destructive grants on either
 * table. We only drop OUR stored access; the owner can also uninstall the
 * app from their Shopify admin to revoke on Shopify's side.
 */
export async function runShopifyDisconnect(
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { status: 503, body: { error: "Store storage isn't configured." } };
  }
  const userId = await resolveUser(env, authHeader);
  if (!userId) return { status: 401, body: { error: "Sign in first." } };

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
  };
  try {
    const [connRes, storeRes] = await Promise.all([
      fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?user_id=eq.${userId}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(6_000),
      }),
      fetch(`${env.supabaseUrl}/rest/v1/stores?user_id=eq.${userId}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(6_000),
      }),
    ]);
    if (!connRes.ok || !storeRes.ok) {
      return { status: 502, body: { error: "Couldn't fully disconnect — try again." } };
    }
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { error: "Couldn't reach store storage — try again." } };
  }
}

/**
 * One GraphQL Admin API call. Returns the `data` object, or null on any
 * failure (HTTP error, GraphQL errors, network). GraphQL is the ONLY Admin
 * API the app speaks — REST is legacy and public apps must not use it.
 */
export async function shopifyGraphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const { data } = await shopifyGraphqlDetailed<T>(shop, token, query, variables);
  return data;
}

/**
 * Like shopifyGraphql but reports WHY the call failed. `accessDenied` means
 * Shopify answered ACCESS_DENIED — the app is missing protected-customer-data
 * access (Partner Dashboard, not an OAuth scope), so retrying or falling back
 * to REST is pointless and the owner needs to be told exactly what to enable.
 */
export async function shopifyGraphqlDetailed<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T | null; accessDenied: boolean }> {
  try {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { data: null, accessDenied: false };
    const json = (await res.json()) as {
      data?: T;
      errors?: { extensions?: { code?: string } }[];
    };
    if (json.errors?.length || !json.data) {
      const denied = (json.errors ?? []).some((e) => e.extensions?.code === "ACCESS_DENIED");
      return { data: null, accessDenied: denied };
    }
    return { data: json.data, accessDenied: false };
  } catch {
    return { data: null, accessDenied: false };
  }
}
