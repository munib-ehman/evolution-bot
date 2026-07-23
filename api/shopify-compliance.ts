/**
 * POST /api/shopify-compliance — Shopify's three mandatory privacy webhooks
 * (customers/data_request, customers/redact, shop/redact) all point here;
 * the topic header routes them. Public by necessity, authenticated by HMAC —
 * an invalid signature MUST answer 401 (Shopify's automated app-review check
 * probes exactly that). Logic lives in _compliance.ts (dev-api runs the same
 * engine).
 */
import { handleShopifyCompliance } from "./_compliance";
import { skillEnvFromProcess } from "./_skills";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const rawBody = await req.text();
  const { status, body } = await handleShopifyCompliance(
    rawBody,
    {
      topic: req.headers.get("x-shopify-topic"),
      shop: req.headers.get("x-shopify-shop-domain"),
      hmac: req.headers.get("x-shopify-hmac-sha256"),
    },
    skillEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
