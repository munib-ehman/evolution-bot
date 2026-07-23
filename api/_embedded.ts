/**
 * Embedded-app session — the Shopify-admin half of auth (engine for
 * /api/shopify-session, shared with dev-api.ts).
 *
 * When the app runs inside the Shopify admin (App Store install), there is no
 * email login: App Bridge hands the SPA a short-lived session token (an HS256
 * JWT signed with our app secret, proving "this request comes from the admin
 * of shop X"). The SPA posts it here and gets back a Supabase magic-link
 * token_hash it can redeem for a real session — auto-login, no password ever.
 *
 * One round trip does everything:
 *   1. verify the session token (signature, expiry, audience, shop domain)
 *   2. ensure we hold an offline Admin API token for the shop — if not
 *      (fresh install, reinstall after uninstall), swap the session token for
 *      one via OAuth TOKEN EXCHANGE (managed installation: Shopify already
 *      collected scope consent during install, so no redirect dance)
 *   3. resolve the Supabase user for the shop (the shop_domain → user_id
 *      mapping in shopify_connections), auto-provisioning one on first
 *      install with a synthetic @users.runevolution.io address
 *   4. sync the Shopify App Pricing subscription state to profiles.plan
 *   5. mint the magic-link token_hash for the SPA
 *
 * A merchant who ALREADY uses Evolution standalone and then installs from the
 * App Store lands on their existing account: step 3 finds their user via the
 * shop_domain mapping created by the standalone OAuth connect.
 */
import {
  normalizeShopDomain,
  saveConnection,
  getConnection,
  shopifyGraphql,
  type ShopifyEnv,
} from "./_shopify";

/** Synthetic-address domain for users auto-provisioned from a Shopify install. */
export const PROVISIONED_EMAIL_DOMAIN = "users.runevolution.io";

export function isProvisionedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${PROVISIONED_EMAIL_DOMAIN}`);
}

const encoder = new TextEncoder();
/** Clock skew tolerance for session-token exp/nbf checks. */
const JWT_SKEW_MS = 5_000;

// ---------------------------------------------------------------------------
// App Bridge session token verification (HS256 JWT, app secret)

function b64urlDecode(part: string): Uint8Array | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

interface SessionTokenClaims {
  iss?: string;
  dest?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  sub?: string;
}

/**
 * Verify an App Bridge session token and return the shop it belongs to,
 * or null. Signature first (nothing in the payload is trusted before that),
 * then freshness, audience, and the destination shop domain.
 */
export async function verifySessionToken(token: string, env: ShopifyEnv): Promise<string | null> {
  if (!env.shopifyApiKey || !env.shopifyApiSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const sigBytes = b64urlDecode(sigB64);
  if (!sigBytes) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.shopifyApiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as unknown as ArrayBuffer,
    encoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) return null;

  const payloadBytes = b64urlDecode(payloadB64);
  if (!payloadBytes) return null;
  let claims: SessionTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionTokenClaims;
  } catch {
    return null;
  }

  const now = Date.now();
  if (typeof claims.exp !== "number" || now > claims.exp * 1000 + JWT_SKEW_MS) return null;
  if (typeof claims.nbf === "number" && now < claims.nbf * 1000 - JWT_SKEW_MS) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.shopifyApiKey)) return null;

  try {
    return normalizeShopDomain(new URL(claims.dest ?? "").hostname);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth token exchange (managed installation — no redirect, no grant code)

async function exchangeSessionToken(
  shop: string,
  sessionToken: string,
  env: ShopifyEnv,
): Promise<{
  access_token: string;
  scopes: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
} | null> {
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.shopifyApiKey,
        client_secret: env.shopifyApiSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      scope?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };
    if (!data.access_token) return null;
    const expiryIso = (s: number | undefined) =>
      typeof s === "number" && Number.isFinite(s) ? new Date(Date.now() + s * 1000).toISOString() : null;
    return {
      access_token: data.access_token,
      scopes: data.scope ?? "",
      refresh_token: data.refresh_token ?? null,
      token_expires_at: expiryIso(data.expires_in),
      refresh_token_expires_at: expiryIso(data.refresh_token_expires_in),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Supabase admin (GoTrue) helpers — service role only

function adminHeaders(env: ShopifyEnv): Record<string, string> {
  return {
    apikey: env.serviceRoleKey ?? "",
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

async function getUserEmail(env: ShopifyEnv, userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: adminHeaders(env),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { email?: string };
    return typeof user.email === "string" && user.email ? user.email : null;
  } catch {
    return null;
  }
}

/** Create the synthetic user for a shop; null on hard failure. */
async function createProvisionedUser(env: ShopifyEnv, shop: string, email: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders(env),
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { shop, provisioned: "shopify" },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null; // 422 = already exists → caller recovers via generate_link
    const user = (await res.json()) as { id?: string };
    return typeof user.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

/**
 * Mint a magic-link token_hash for the email (NO email is sent — the link is
 * generated, not delivered). Also returns the user id, which doubles as the
 * recovery path when the user already exists.
 */
async function generateMagicLink(
  env: ShopifyEnv,
  email: string,
): Promise<{ tokenHash: string; userId: string } | null> {
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: adminHeaders(env),
      body: JSON.stringify({ type: "magiclink", email }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    // GoTrue merges user fields and link properties at the top level; the
    // supabase-js shape nests them — accept both.
    const json = (await res.json()) as {
      hashed_token?: string;
      id?: string;
      properties?: { hashed_token?: string };
      user?: { id?: string };
    };
    const tokenHash = json.hashed_token ?? json.properties?.hashed_token ?? "";
    const userId = json.id ?? json.user?.id ?? "";
    return tokenHash && userId ? { tokenHash, userId } : null;
  } catch {
    return null;
  }
}

/** Ensure a profiles row exists (mirror of the client's ensureProfile). */
async function ensureProfileRow(env: ShopifyEnv, userId: string, email: string): Promise<void> {
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?on_conflict=user_id`, {
      method: "POST",
      headers: {
        ...adminHeaders(env),
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: userId, email }),
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    /* best-effort — the client's ensureProfile covers the gap */
  }
}

// ---------------------------------------------------------------------------
// Billing sync — Shopify App Pricing state → profiles.plan

const SUBSCRIPTIONS_QUERY = `query EvolutionBilling {
  currentAppInstallation {
    activeSubscriptions { status }
  }
}`;

/**
 * Best-effort backstop for the app_subscriptions/update webhook, so the plan
 * is right on the very first load after an install or upgrade even if a
 * webhook was missed. Same ownership rule as the webhook: ACTIVE claims the
 * plan for Shopify billing; absence releases it only from plan_source=shopify.
 */
export async function syncShopifyPlan(env: ShopifyEnv, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  const conn = await getConnection(env, userId);
  if (!conn) return;
  const data = await shopifyGraphql<{
    currentAppInstallation?: { activeSubscriptions?: { status?: string }[] };
  }>(conn.shop_domain, conn.access_token, SUBSCRIPTIONS_QUERY, {});
  if (!data) return; // can't tell — leave the plan alone

  const active = (data.currentAppInstallation?.activeSubscriptions ?? []).some(
    (s) => (s.status ?? "").toUpperCase() === "ACTIVE",
  );
  const filter = active
    ? `user_id=eq.${userId}`
    : `user_id=eq.${userId}&plan_source=eq.shopify`;
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?${filter}`, {
      method: "PATCH",
      headers: { ...adminHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify(active ? { plan: "operator", plan_source: "shopify" } : { plan: "free" }),
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    /* next load re-syncs */
  }
}

// ---------------------------------------------------------------------------
// POST /api/shopify-session — the whole embedded bootstrap

export async function runShopifySession(
  body: { sessionToken?: unknown },
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.shopifyApiKey || !env.shopifyApiSecret || !env.supabaseUrl || !env.serviceRoleKey) {
    return { status: 503, body: { error: "Shopify embedded mode isn't configured." } };
  }
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  const shop = sessionToken ? await verifySessionToken(sessionToken, env) : null;
  if (!shop) return { status: 401, body: { error: "Invalid Shopify session." } };

  // Who owns this shop? (Tombstoned rows still map shop → user.)
  let userId: string | null = null;
  try {
    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/shopify_connections?shop_domain=eq.${encodeURIComponent(shop)}&select=user_id`,
      { headers: adminHeaders(env), signal: AbortSignal.timeout(4_000) },
    );
    if (res.ok) {
      const rows = (await res.json()) as { user_id?: string }[];
      userId = rows[0]?.user_id ?? null;
    }
  } catch {
    /* treated as no row */
  }

  const syntheticEmail = `shop-${shop.replace(".myshopify.com", "")}@${PROVISIONED_EMAIL_DOMAIN}`;
  let email: string | null = null;

  if (userId) {
    email = await getUserEmail(env, userId);
    if (!email) return { status: 502, body: { error: "Couldn't load your account — try again." } };
  } else {
    // First install: provision the account. If the auth user already exists
    // (e.g. connection row was redacted but the user survived), the create
    // 422s and generateMagicLink below recovers the id.
    email = syntheticEmail;
    userId = await createProvisionedUser(env, shop, syntheticEmail);
  }

  // Hold a working Admin API token — fresh installs and reinstalls exchange
  // the session token for one (consent was collected by managed installation).
  const existingConn = userId ? await getConnection(env, userId) : null;
  let fields: Awaited<ReturnType<typeof exchangeSessionToken>> = null;
  if (!existingConn) {
    fields = await exchangeSessionToken(shop, sessionToken, env);
    if (!fields) return { status: 502, body: { error: "Couldn't connect to your store — reopen the app." } };
  }

  // Mint the login (also resolves userId when the create-user call 422'd).
  const link = await generateMagicLink(env, email);
  if (!link) return { status: 502, body: { error: "Couldn't sign you in — try again." } };
  userId = userId ?? link.userId;

  if (fields) {
    const saved = await saveConnection(env, userId, shop, fields);
    if (!saved) return { status: 502, body: { error: "Couldn't save the store connection — try again." } };
  }
  await ensureProfileRow(env, userId, email);
  await syncShopifyPlan(env, userId);

  return { status: 200, body: { token_hash: link.tokenHash, shop } };
}
