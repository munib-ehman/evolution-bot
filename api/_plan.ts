/**
 * Plan gating — the server-side half of the paywall.
 *
 * Free accounts get the audit funnel (and the coming product-hunt teaser);
 * everything that costs real money to serve — agent chat, skills, recovery,
 * retention, ops, catalog — requires profiles.plan = 'operator'. The UI hides
 * those surfaces from free users; this rejects anyone calling the APIs
 * directly. plan is set only by billing webhooks (Shopify / Polar) or the
 * team (plan_source = manual) — there is no user UPDATE policy on profiles.
 *
 * FAIL-CLOSED: if the plan can't be read, the caller is treated as free.
 * Every gated endpoint depends on Supabase anyway, so a Supabase outage
 * would break the request regardless — failing closed just makes the
 * billing boundary the strict one.
 */
import { log } from "./_log";
import type { AuditEnv } from "./_audit";

export const OPERATOR_REQUIRED = {
  status: 402,
  body: {
    error: "This is an Operator feature — upgrade your plan to unlock it.",
    needsUpgrade: true,
  },
} as const;

export async function isOperator(
  env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey">,
  userId: string,
): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return true; // demo deployment: no billing
  try {
    const res = await fetch(
      `${env.supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=plan&limit=1`,
      {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!res.ok) {
      log("warn", "plan", "plan_lookup_failed", { status: res.status });
      return false;
    }
    const rows = (await res.json()) as { plan?: string }[];
    return rows[0]?.plan === "operator";
  } catch {
    log("warn", "plan", "plan_lookup_unreachable", {});
    return false;
  }
}
