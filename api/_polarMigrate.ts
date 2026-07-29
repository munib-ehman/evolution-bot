/**
 * Polar → Shopify billing migration, run when a store connects.
 *
 * A web customer can buy on Polar first and connect their Shopify store
 * later — but once connected, App Store policy says all billing goes through
 * Shopify App Pricing. So the moment a connection lands (OAuth callback or
 * embedded install), any active Polar subscription is set to cancel AT PERIOD
 * END: the customer keeps the month they paid for, Polar's
 * subscription.revoked webhook downgrades the plan when it lapses, and the
 * upgrade panel (which routes connected accounts to Shopify) takes over from
 * there. Idempotent — already-cancelling subscriptions are left alone.
 *
 * Self-contained module (only imports the logger): _shopify.ts calls this,
 * and _polar.ts imports _shopify.ts, so importing _polar from here would be
 * an import cycle. PolarEnv satisfies this env shape structurally.
 */
import { log } from "./_log";

export interface PolarMigrateEnv {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  polarToken?: string;
  polarApiBase?: string;
}

interface PolarSubscription {
  id?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  current_period_end?: string | null;
}

/** Never throws — a billing hiccup must not break the store-connect flow. */
export async function migratePolarToShopify(env: PolarMigrateEnv, userId: string): Promise<void> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  const apiBase = env.polarApiBase || "https://api.polar.sh";

  try {
    // Only Polar-billed accounts have anything to migrate.
    const profileRes = await fetch(
      `${env.supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=plan_source`,
      {
        headers: {
          apikey: env.serviceRoleKey,
          Authorization: `Bearer ${env.serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!profileRes.ok) return;
    const rows = (await profileRes.json()) as { plan_source?: string }[];
    if (rows[0]?.plan_source !== "polar") return;

    if (!env.polarToken) {
      // Plan says Polar but we can't reach it — flag for a manual fix.
      log("warn", "polar-migrate", "migrate_skipped", { userId, reason: "no-token" });
      return;
    }

    const polarHeaders = {
      Authorization: `Bearer ${env.polarToken}`,
      "Content-Type": "application/json",
    };
    // external_customer_id is our Supabase user id (set at checkout).
    const listRes = await fetch(
      `${apiBase}/v1/subscriptions/?external_customer_id=${encodeURIComponent(userId)}&active=true&limit=10`,
      { headers: polarHeaders, signal: AbortSignal.timeout(10_000) },
    );
    if (!listRes.ok) {
      log("error", "polar-migrate", "migrate_failed", { userId, step: "list", status: listRes.status });
      return;
    }
    const subs = ((await listRes.json()) as { items?: PolarSubscription[] }).items ?? [];

    for (const sub of subs) {
      if (!sub.id || sub.cancel_at_period_end) continue;
      const patchRes = await fetch(`${apiBase}/v1/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: polarHeaders,
        body: JSON.stringify({ cancel_at_period_end: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (patchRes.ok) {
        log("info", "polar-migrate", "migrate_scheduled", {
          userId,
          subscriptionId: sub.id,
          endsAt: sub.current_period_end ?? null,
        });
      } else {
        log("error", "polar-migrate", "migrate_failed", {
          userId,
          subscriptionId: sub.id,
          step: "cancel",
          status: patchRes.status,
        });
      }
    }
  } catch {
    log("error", "polar-migrate", "migrate_failed", { userId, step: "network" });
  }
}
