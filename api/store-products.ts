/**
 * GET /api/store-products — the signed-in owner's slim live catalog, fetched
 * by the chat client at load so the copilot is grounded in real product names
 * and prices. Requires the Supabase bearer; 409 until a store is connected.
 * All real logic lives in _catalog.ts so dev-api.ts runs the identical engine.
 */
import { runStoreCatalog } from "./_catalog";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { status, body } = await runStoreCatalog(
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
