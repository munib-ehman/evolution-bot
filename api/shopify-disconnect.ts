/**
 * POST /api/shopify-disconnect — the signed-in owner severs their store:
 * deletes the Shopify connection (token row) and the stores row so a
 * different store can be connected. Requires the Supabase bearer. All real
 * logic lives in _shopify.ts so dev-api.ts runs the identical engine.
 */
import { runShopifyDisconnect, shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { status, body } = await runShopifyDisconnect(
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
