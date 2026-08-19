/**
 * Polar billing (polar.sh, merchant of record) — the WEB checkout rail.
 *
 * Two mutually exclusive rails bill independently purchasable managers:
 *   - Shopify-connected accounts → Shopify App Pricing (App Store policy
 *     forbids off-platform billing for them; see _events.ts subscription sync)
 *   - everyone else → Polar hosted checkout, wired here
 * profiles.plan_source keeps the rails independent: this webhook only ever
 * downgrades plan_source='polar' rows, Shopify's only 'shopify' rows.
 *
 * Engines shared by the edge shells (polar-checkout.ts, polar-webhook.ts)
 * and dev-api.ts:
 *   runPolarCheckout  — POST /v1/checkouts/ with the caller's identity in
 *       external_customer_id + metadata.user_id, returns the hosted URL.
 *   handlePolarWebhook — Standard Webhooks signature verification, then
 *       subscription.active → operator/polar, subscription.revoked → free.
 *       Returns a retryable error when the plan update fails, and 401 only on
 *       a bad signature.
 */
import { resolveUserFull, type AuditEnv } from "./_audit";
import { getConnection } from "./_shopify";
import { log } from "./_log";
import { ROLES, type Role } from "./_plan";

export interface PolarEnv extends AuditEnv {
  polarToken?: string;
  polarWebhookSecret?: string;
  /** Override with https://sandbox-api.polar.sh while testing. */
  polarApiBase?: string;
}

export function polarEnvFromProcess(): PolarEnv {
  return {
    supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    polarToken: (process.env.POLAR_ACCESS_TOKEN ?? "").trim(),
    polarWebhookSecret: (process.env.POLAR_WEBHOOK_SECRET ?? "").trim(),
    polarApiBase: (process.env.POLAR_API_BASE ?? "").trim() || "https://api.polar.sh",
  };
}

export function polarConfigured(env: PolarEnv): boolean {
  return Boolean(env.polarToken && env.supabaseUrl && env.serviceRoleKey);
}

async function polarProductForRole(env: PolarEnv, role: Role): Promise<string | null> {
  const key = env.serviceRoleKey ?? "";
  if (!env.supabaseUrl || !key) return null;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/manager_plans?role=eq.${encodeURIComponent(role)}&active=eq.true&select=polar_product_id&limit=1`, {
    headers: { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }) },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) return null;
  const rows = await res.json() as { polar_product_id?: string | null }[];
  return rows[0]?.polar_product_id?.trim() || null;
}

const serviceHeaders=(env:PolarEnv)=>{const key=env.serviceRoleKey??"";return {apikey:key,...(key.startsWith("sb_secret_")?{}:{Authorization:`Bearer ${key}`})};};
async function loadPolarBilling(env:PolarEnv,userId:string){const response=await fetch(`${env.supabaseUrl}/rest/v1/role_entitlements?user_id=eq.${userId}&status=eq.active&billing_provider=eq.polar&select=role,provider_subscription_id`,{headers:serviceHeaders(env),signal:AbortSignal.timeout(4_000)});if(!response.ok)return {roles:[] as Role[],subscriptionId:null as string|null};const rows=await response.json() as {role?:string;provider_subscription_id?:string|null}[];return {roles:rows.map(row=>row.role).filter((role):role is Role=>ROLES.includes(role as Role)),subscriptionId:rows.find(row=>row.provider_subscription_id)?.provider_subscription_id??null};}
async function saveCheckoutIntent(env:PolarEnv,userId:string,roles:Role[],subscriptionId?:string|null){const response=await fetch(`${env.supabaseUrl}/rest/v1/manager_checkout_intents?on_conflict=user_id`,{method:"POST",headers:{...serviceHeaders(env),"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:userId,roles,status:"pending",polar_subscription_id:subscriptionId??null,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(4_000)});return response.ok;}

// ---------------------------------------------------------------------------
// POST /api/polar-checkout — mint a hosted checkout session for the caller

export async function runPolarCheckout(
  authHeader: string | null,
  origin: string,
  env: PolarEnv,
  roleValue: unknown = ["marketing"],
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!polarConfigured(env)) {
    return { status: 503, body: { error: "Checkout isn't configured yet — email us instead." } };
  }
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { status: 401, body: { error: "Sign in first." } };
  const requested=Array.isArray(roleValue)?roleValue:[roleValue];
  const roles=[...new Set(requested.filter((value):value is Role=>ROLES.includes(value as Role)))];
  if(!roles.length||roles.length!==requested.length)return {status:400,body:{error:"Choose at least one valid manager."}};
  const billing=await loadPolarBilling(env,user.id);
  const targetRoles=[...new Set([...billing.roles,...roles])];
  const products=await Promise.all(roles.map(async role=>({role,productId:await polarProductForRole(env,role)})));
  const missing=products.find(item=>!item.productId);
  if(missing)return {status:503,body:{error:`Checkout is not configured for ${missing.role}.`}};

  // App Store policy: Shopify-connected accounts must bill through Shopify
  // App Pricing. The UI already routes them there — this enforces it.
  if (await getConnection(env, user.id)) {
    return {
      status: 409,
      body: { error: "Your store is connected to Shopify — choose your plan from your Shopify admin instead." },
    };
  }

  if(!(await saveCheckoutIntent(env,user.id,targetRoles,billing.subscriptionId)))return {status:502,body:{error:"Couldn't save your manager selection."}};
  if(billing.subscriptionId){
    try{
      const updated=await fetch(`${env.polarApiBase}/v1/subscriptions/${billing.subscriptionId}`,{method:"PATCH",headers:{Authorization:`Bearer ${env.polarToken}`,"Content-Type":"application/json"},body:JSON.stringify({seats:targetRoles.length}),signal:AbortSignal.timeout(10_000)});
      if(!updated.ok)return {status:502,body:{error:"Couldn't update your manager subscription."}};
      return {status:200,body:{url:`${origin}/app?upgrade=success`}};
    }catch{return {status:502,body:{error:"Couldn't reach the payment provider."}};}
  }

  try {
    const res = await fetch(`${env.polarApiBase}/v1/checkouts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.polarToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // One seat is billed for each selected manager.
        products: [products[0].productId],
        seats: targetRoles.length,
        min_seats: targetRoles.length,
        max_seats: targetRoles.length,
        success_url: `${origin}/app?upgrade=success`,
        customer_email: user.email ?? undefined,
        external_customer_id: user.id,
        // Metadata rides along to the subscription object, so the webhook can
        // map it back to our user without a customer lookup.
        metadata: { user_id: user.id },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log("error", "polar-checkout", "create_failed", { status: res.status });
      return { status: 502, body: { error: "Couldn't start checkout — try again in a minute." } };
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      log("error", "polar-checkout", "create_failed", { reason: "no-url" });
      return { status: 502, body: { error: "Couldn't start checkout — try again in a minute." } };
    }
    return { status: 200, body: { url: data.url } };
  } catch {
    log("error", "polar-checkout", "create_failed", { reason: "network" });
    return { status: 502, body: { error: "Couldn't reach the payment provider — try again." } };
  }
}

// ---------------------------------------------------------------------------
// POST /api/polar-portal — mint a customer-portal session so web-rail
// subscribers can manage/cancel their subscription themselves (Shopify-rail
// subscriptions are managed in the Shopify admin instead). Requires the org
// token to carry the customer_sessions:write scope.

export async function runPolarPortal(
  authHeader: string | null,
  env: PolarEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.polarToken) {
    return { status: 503, body: { error: "Billing isn't configured yet — email us instead." } };
  }
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { status: 401, body: { error: "Sign in first." } };

  try {
    // external_customer_id is our Supabase user id — checkout sets it, so any
    // account that ever bought through Polar resolves here.
    const res = await fetch(`${env.polarApiBase}/v1/customer-sessions/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.polarToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ external_customer_id: user.id }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log("warn", "polar-portal", "session_failed", { status: res.status });
      return {
        status: 404,
        body: { error: "No Polar subscription on this account — if you subscribed another way, email us and we'll sort it out." },
      };
    }
    const data = (await res.json()) as { customer_portal_url?: string };
    if (!data.customer_portal_url) {
      log("error", "polar-portal", "session_failed", { reason: "no-url" });
      return { status: 502, body: { error: "Couldn't open the billing portal — try again in a minute." } };
    }
    return { status: 200, body: { url: data.customer_portal_url } };
  } catch {
    log("error", "polar-portal", "session_failed", { reason: "network" });
    return { status: 502, body: { error: "Couldn't reach the billing provider — try again." } };
  }
}

// ---------------------------------------------------------------------------
// Standard Webhooks verification implemented with Web Crypto so this module
// remains compatible with Vercel's Edge runtime. Polar's SDK treats the
// configured secret as UTF-8 bytes (including the `whsec_` prefix), rather
// than base64-decoding the suffix.

const TIMESTAMP_TOLERANCE_SECS = 5 * 60;
const encoder = new TextEncoder();

export async function verifyPolarSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_TOLERANCE_SECS) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${headers.id}.${headers.timestamp}.${rawBody}`),
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(signature)));

    for (const candidate of headers.signature.split(" ")) {
      const [version, value] = candidate.split(",", 2);
      if (version !== "v1" || !value || value.length !== expected.length) continue;
      let diff = 0;
      for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ value.charCodeAt(i);
      }
      if (diff === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/polar-webhook

interface PolarWebhookPayload {
  type?: string;
  data?: {
    id?: string;
    product_id?: string;
    metadata?: Record<string, unknown>;
    customer?: { external_id?: string | null };
  };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

function payloadUserId(payload: PolarWebhookPayload): string | null {
  const fromMeta = payload.data?.metadata?.user_id;
  if (typeof fromMeta === "string" && UUID_RE.test(fromMeta)) return fromMeta;
  const fromCustomer = payload.data?.customer?.external_id;
  if (typeof fromCustomer === "string" && UUID_RE.test(fromCustomer)) return fromCustomer;
  return null;
}

export async function handlePolarWebhook(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  env: PolarEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.polarWebhookSecret) {
    return { status: 503, body: { error: "Polar webhook secret not configured." } };
  }
  if (!(await verifyPolarSignature(env.polarWebhookSecret, headers, rawBody))) {
    log("warn", "polar-webhook", "signature_rejected", {});
    return { status: 401, body: { error: "Invalid webhook signature." } };
  }

  let payload: PolarWebhookPayload = {};
  try {
    payload = JSON.parse(rawBody) as PolarWebhookPayload;
  } catch {
    log("warn", "polar-webhook", "payload_rejected", {});
    return { status: 400, body: { error: "Invalid webhook payload." } };
  }
  const type = payload.type ?? "";
  const userId = payloadUserId(payload);
  const intentResponse=userId?await fetch(`${env.supabaseUrl}/rest/v1/manager_checkout_intents?user_id=eq.${userId}&select=roles&limit=1`,{headers:serviceHeaders(env),signal:AbortSignal.timeout(4_000)}):null;
  const intentRows=intentResponse?.ok?await intentResponse.json() as {roles?:string[]}[]:[];
  const intentRoles=(intentRows[0]?.roles??[]).filter((role):role is Role=>ROLES.includes(role as Role));

  // Only the two definitive lifecycle moments touch the plan. canceled keeps
  // access until the period ends — revoked is when the benefits actually stop.
  if ((type === "subscription.active" || type === "subscription.updated" || type === "subscription.revoked") && userId && intentRoles.length) {
    const active = type !== "subscription.revoked";
    try {
      const deactivate=await fetch(`${env.supabaseUrl}/rest/v1/role_entitlements?user_id=eq.${userId}&billing_provider=eq.polar`,{method:"PATCH",headers:{...serviceHeaders(env),"Content-Type":"application/json"},body:JSON.stringify({status:"inactive",updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(6_000)});
      if(!deactivate.ok)throw new Error("Role reset failed");
      const response = await fetch(`${env.supabaseUrl}/rest/v1/role_entitlements?on_conflict=user_id,role`, {
        method: "POST",
        headers: {
          apikey: env.serviceRoleKey ?? "",
          Authorization: `Bearer ${env.serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(intentRoles.map(role=>({user_id:userId,role,status:active?"active":"inactive",billing_provider:"polar",provider_product_id:payload.data?.product_id??null,provider_subscription_id:payload.data?.id??null,updated_at:new Date().toISOString()}))),
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) {
        log("error", "polar-webhook", "plan_sync_failed", { userId, type, status: response.status });
        return { status: 502, body: { error: "Plan update failed." } };
      }
      log("info", "polar-webhook", "plan_synced", { userId, type });
    } catch {
      log("error", "polar-webhook", "plan_sync_failed", { userId, type });
      return { status: 502, body: { error: "Plan update failed." } };
    }
  }

  return { status: 200, body: { received: true } };
}

async function roleForPolarProduct(env: PolarEnv, productId?: string): Promise<Role | null> {
  const key = env.serviceRoleKey ?? "";
  if (!productId || !env.supabaseUrl || !key) return null;
  const response = await fetch(`${env.supabaseUrl}/rest/v1/manager_plans?polar_product_id=eq.${encodeURIComponent(productId)}&select=role&limit=1`, {
    headers: { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }) },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return null;
  const rows = await response.json() as { role?: string }[];
  return ROLES.includes(rows[0]?.role as Role) ? rows[0]?.role as Role : null;
}
