/**
 * Fixed-window rate limiting on a Supabase RPC (see
 * supabase/2026-07-27_rate_limits.sql). Chosen over a Redis vendor to keep
 * the infra footprint at "Supabase + Vercel", and over in-isolate memory
 * because edge isolates are ephemeral and plural — a counter that resets on
 * every cold start limits nothing.
 *
 * FAIL-OPEN by design: the audit is the lead funnel; a limiter outage must
 * never take it down. A denial requires a definitive `false` from the RPC.
 */
import { log } from "./_log";
import type { AuditEnv } from "./_audit";

/** First hop of x-forwarded-for is the client on Vercel. */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Salted SHA-256, truncated to 32 hex chars. The salt is a fixed app string —
 * this is data minimization (no raw IPs at rest), not secrecy.
 */
export async function hashKey(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(["evolution-rl-v1", ...parts].join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** True = allowed. Missing env, RPC error, or timeout all allow. */
export async function checkRateLimit(
  env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey">,
  key: string,
  windowSecs: number,
  max: number,
): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return true;
  try {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/rate_limit_hit`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_key: key, p_window_secs: windowSecs, p_max: max }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) {
      log("warn", "ratelimit", "rpc_failed", { status: res.status });
      return true;
    }
    return (await res.json()) !== false;
  } catch {
    log("warn", "ratelimit", "rpc_unreachable", {});
    return true;
  }
}
