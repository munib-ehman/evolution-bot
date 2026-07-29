/**
 * POST /api/polar-webhook — Polar's delivery endpoint (public by necessity,
 * authenticated by the Standard Webhooks signature). subscription.active and
 * subscription.revoked sync profiles.plan for plan_source='polar' accounts.
 * Logic lives in _polar.ts (dev-api runs the same engine).
 */
import { handlePolarWebhook, polarEnvFromProcess } from "./_polar";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const rawBody = await req.text();
  const { status, body } = await handlePolarWebhook(
    rawBody,
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    polarEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
