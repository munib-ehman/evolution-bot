/**
 * POST /api/polar-portal — mint a Polar customer-portal URL for the signed-in
 * caller, where they manage/cancel their web-rail subscription. Logic lives
 * in _polar.ts (dev-api runs the same engine).
 */
import { runPolarPortal, polarEnvFromProcess } from "./_polar";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { status, body } = await runPolarPortal(
    req.headers.get("authorization"),
    polarEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
