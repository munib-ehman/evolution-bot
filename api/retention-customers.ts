/**
 * GET /api/retention-customers — the signed-in owner's lapsed customers
 * (win-back) and recent buyers (review requests) with customer detail. Like
 * /api/recovery-carts this is a PII path: the data goes to the owner's
 * browser only, never into LLM context. Requires the Supabase bearer; 409
 * until a store is connected. Logic lives in _retention.ts (dev-api runs the
 * same engine).
 */
import { runRetentionCustomers } from "./_retention";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { status, body } = await runRetentionCustomers(
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
