/**
 * Polar billing (polar.sh, merchant of record) — the WEB checkout rail.
 *
 * Two mutually exclusive rails bill the $100/mo Operator plan:
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
 *       Like the Shopify webhook: 200 after a valid signature no matter what
 *       (Polar retries non-2xx up to 10 times), 401 only on a bad signature.
 */
import { resolveUserFull, type AuditEnv } from "./_audit";
import { getConnection } from "./_shopify";
import { log } from "./_log";

export interface PolarEnv extends AuditEnv {
  polarToken?: string;
  polarProductId?: string;
  polarWebhookSecret?: string;
  /** Override with https://sandbox-api.polar.sh while testing. */
  polarApiBase?: string;
}

export function polarEnvFromProcess(): PolarEnv {
  return {
    supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    polarToken: (process.env.POLAR_ACCESS_TOKEN ?? "").trim(),
    polarProductId: (process.env.POLAR_PRODUCT_ID ?? "").trim(),
    polarWebhookSecret: (process.env.POLAR_WEBHOOK_SECRET ?? "").trim(),
    polarApiBase: (process.env.POLAR_API_BASE ?? "").trim() || "https://api.polar.sh",
  };
}

export function polarConfigured(env: PolarEnv): boolean {
  return Boolean(env.polarToken && env.polarProductId);
}

// ---------------------------------------------------------------------------
// POST /api/polar-checkout — mint a hosted checkout session for the caller

export async function runPolarCheckout(
  authHeader: string | null,
  origin: string,
  env: PolarEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!polarConfigured(env)) {
    return { status: 503, body: { error: "Checkout isn't configured yet — email us instead." } };
  }
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { status: 401, body: { error: "Sign in first." } };

  // App Store policy: Shopify-connected accounts must bill through Shopify
  // App Pricing. The UI already routes them there — this enforces it.
  if (await getConnection(env, user.id)) {
    return {
      status: 409,
      body: { error: "Your store is connected to Shopify — choose your plan from your Shopify admin instead." },
    };
  }

  try {
    const res = await fetch(`${env.polarApiBase}/v1/checkouts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.polarToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        products: [env.polarProductId],
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
// Standard Webhooks signature (https://www.standardwebhooks.com/): HMAC-SHA256
// over `${id}.${timestamp}.${body}`, keyed with the base64-DECODED whsec_
// secret; header carries space-separated `v1,<base64sig>` candidates.

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

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    keyBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${headers.id}.${headers.timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // The header may list several versioned signatures (key rotation).
  for (const candidate of headers.signature.split(" ")) {
    const [version, value] = candidate.split(",", 2);
    if (version !== "v1" || !value) continue;
    if (value.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ value.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// POST /api/polar-webhook

interface PolarWebhookPayload {
  type?: string;
  data?: {
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
    return { status: 200, body: { received: true } };
  }
  const type = payload.type ?? "";
  const userId = payloadUserId(payload);

  // Only the two definitive lifecycle moments touch the plan. canceled keeps
  // access until the period ends — revoked is when the benefits actually stop.
  if ((type === "subscription.active" || type === "subscription.revoked") && userId) {
    const active = type === "subscription.active";
    const filter = active
      ? `user_id=eq.${userId}`
      : `user_id=eq.${userId}&plan_source=eq.polar`;
    try {
      await fetch(`${env.supabaseUrl}/rest/v1/profiles?${filter}`, {
        method: "PATCH",
        headers: {
          apikey: env.serviceRoleKey ?? "",
          Authorization: `Bearer ${env.serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(active ? { plan: "operator", plan_source: "polar" } : { plan: "free" }),
        signal: AbortSignal.timeout(6_000),
      });
      log("info", "polar-webhook", "plan_synced", { userId, type });
    } catch {
      // Answer 200 anyway — Polar's retries would re-run the same PATCH, but
      // a support ping beats a retry storm; the log line is the alert.
      log("error", "polar-webhook", "plan_sync_failed", { userId, type });
    }
  }

  return { status: 200, body: { received: true } };
}
