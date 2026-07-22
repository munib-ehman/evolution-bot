/**
 * POST /api/ops-live — idempotently registers this deployment's Shopify
 * webhook subscriptions for the signed-in owner's store, turning on live
 * push for the Operations Center. Requires the Supabase bearer. Logic lives
 * in _events.ts (dev-api runs the same engine and reports live:false —
 * Shopify can't call localhost).
 */
import { runOpsLiveSetup } from "./_events";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { status, body } = await runOpsLiveSetup(
    req.headers.get("authorization"),
    new URL(req.url).origin,
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
