/**
 * Shopify mandatory compliance (GDPR) webhooks — engine for
 * /api/shopify-compliance, shared with dev-api.ts.
 *
 * Every App Store app must answer three topics, HMAC-verified exactly like
 * ordinary webhooks (Shopify's automated submission check posts an invalid
 * signature and requires a 401 back):
 *
 *   customers/data_request — a customer asked the merchant for their data.
 *       Evolution stores NO customer data (PII is fetched live from Shopify
 *       and streamed to the owner's browser only — see _shopifyData.ts), so
 *       the answer is "nothing held"; we file a task + email the team so the
 *       merchant gets that answer well inside the 30-day window.
 *   customers/redact — erase one customer. Nothing to erase (same reason);
 *       logged for the audit trail.
 *   shop/redact — sent ~48h after uninstall: erase everything about the
 *       store. The app/uninstalled tombstone kept the shop→user mapping
 *       alive precisely so this handler can find what to delete.
 *
 * Handlers are idempotent and answer 200 even when there's nothing to do —
 * Shopify retries non-2xx responses, and a redact that finds nothing left IS
 * a success.
 */
import { verifyWebhookHmac, lookupUserByShop, claimWebhook } from "./_events";
import { isProvisionedEmail } from "./_embedded";
import { sendTaskEmail } from "./_email";
import { log } from "./_log";
import type { SkillEnv } from "./_skillTools";

interface CompliancePayload {
  shop_domain?: string;
  customer?: { id?: number; email?: string };
  orders_requested?: number[];
}

function jsonResult(status: number, body: Record<string, unknown>) {
  return { status, body };
}

function svcHeaders(env: SkillEnv): Record<string, string> {
  return {
    apikey: env.serviceRoleKey ?? "",
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

/** File the request in the ops queue + ping the team. Best-effort. */
async function logComplianceTask(
  env: SkillEnv,
  userId: string | null,
  shop: string,
  topic: string,
  summary: string,
): Promise<void> {
  if (userId && env.supabaseUrl && env.serviceRoleKey) {
    try {
      await fetch(`${env.supabaseUrl}/rest/v1/tasks`, {
        method: "POST",
        headers: svcHeaders(env),
        body: JSON.stringify({ user_id: userId, tool: "compliance", request: summary }),
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      /* email below still goes out */
      log("warn", "compliance", "task_insert_failed", { topic, shop });
    }
  }
  await sendTaskEmail(env, {
    userEmail: null,
    shopDomain: shop,
    tool: `compliance:${topic}`,
    request: summary,
    taskId: null,
    origin: "https://www.runevolution.io",
  });
}

/** Erase every trace of a shop. Idempotent — missing rows are a no-op. */
async function redactShop(env: SkillEnv, shop: string, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  const headers = svcHeaders(env);
  const del = (path: string) =>
    fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);

  // Shop-scoped data first (audits are keyed by store_url, not user).
  await Promise.all([
    del(`store_events?user_id=eq.${userId}`),
    del(`recovery_sequences?user_id=eq.${userId}`),
    del(`retention_sequences?user_id=eq.${userId}`),
    del(`audits?store_url=eq.${encodeURIComponent(`https://${shop}`)}`),
    del(`stores?user_id=eq.${userId}`),
  ]);
  // The tombstoned connection row — its job (shop → user for this very
  // webhook) is done.
  await del(`shopify_connections?user_id=eq.${userId}`);

  // Accounts we auto-provisioned from the Shopify install exist ONLY for
  // this shop — delete the whole auth user (cascades profiles, tasks, chat
  // history). A real-email account (standalone signup that connected this
  // shop) survives; only the shop's data is gone.
  try {
    const userRes = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers,
      signal: AbortSignal.timeout(4_000),
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as { email?: string };
      if (isProvisionedEmail(user.email)) {
        await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(8_000),
        });
      }
    }
  } catch {
    /* connection + data are already gone — user cleanup can be manual */
    log("warn", "compliance", "auth_user_cleanup_failed", { shop, userId });
  }
}

export async function handleShopifyCompliance(
  rawBody: string,
  headers: { topic: string | null; shop: string | null; hmac: string | null; webhookId?: string | null },
  env: SkillEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ok = await verifyWebhookHmac(env.shopifyApiSecret ?? "", rawBody, headers.hmac);
  if (!ok) {
    log("warn", "compliance", "hmac_rejected", { topic: headers.topic, shop: headers.shop });
    return jsonResult(401, { error: "Invalid webhook signature." });
  }

  // Redelivered? The redact/task work already happened — don't file duplicate
  // ops tasks or re-send team emails. (Handlers stay idempotent regardless;
  // the claim fails open, so a missed dedupe just repeats no-op-safe work.)
  if (!(await claimWebhook(env, headers.webhookId ?? null, headers.topic, headers.shop))) {
    log("info", "compliance", "duplicate_skipped", { topic: headers.topic, shop: headers.shop });
    return jsonResult(200, { ok: true, duplicate: true });
  }

  let payload: CompliancePayload = {};
  try {
    payload = JSON.parse(rawBody) as CompliancePayload;
  } catch {
    /* header shop still identifies the store */
  }
  const shop = (headers.shop ?? payload.shop_domain ?? "").trim().toLowerCase();
  const topic = headers.topic ?? "";
  const userId = shop ? await lookupUserByShop(env, shop) : null;

  if (topic === "shop/redact") {
    if (userId) await redactShop(env, shop, userId);
    return jsonResult(200, { ok: true });
  }

  if (topic === "customers/data_request") {
    const orders = (payload.orders_requested ?? []).length;
    await logComplianceTask(
      env,
      userId,
      shop,
      topic,
      `Customer data request from ${shop} (customer id ${payload.customer?.id ?? "?"}, ${orders} order(s) referenced). ` +
        "Evolution stores no customer data — reply to the merchant that nothing is held. Respond within 30 days.",
    );
    return jsonResult(200, { ok: true });
  }

  if (topic === "customers/redact") {
    await logComplianceTask(
      env,
      userId,
      shop,
      topic,
      `Customer redaction request from ${shop} (customer id ${payload.customer?.id ?? "?"}). ` +
        "Evolution stores no customer data — nothing to erase. Logged for the audit trail.",
    );
    return jsonResult(200, { ok: true });
  }

  // Unknown topic on this endpoint — acknowledge so Shopify doesn't retry.
  return jsonResult(200, { ok: true });
}
