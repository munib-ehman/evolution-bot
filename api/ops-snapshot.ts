/**
 * GET /api/ops-snapshot — a live operations snapshot for the signed-in
 * owner's store: today's pulse, the ship queue, and the inventory watch.
 * Non-PII (order numbers and product titles only). Requires the Supabase
 * bearer; 409 until a store is connected. Logic lives in _ops.ts (dev-api
 * runs the same engine). The panel polls this while open.
 */
import { runOpsSnapshot } from "./_ops";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { status, body } = await runOpsSnapshot(
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
