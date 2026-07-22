/**
 * POST /api/shopify-webhook — Shopify's webhook delivery endpoint (public by
 * necessity, authenticated by HMAC signature instead of a bearer). Maps
 * deliveries to store_events rows; Supabase Realtime pushes them to the
 * owner's browser. Logic lives in _events.ts (dev-api runs the same engine).
 */
import { handleShopifyWebhook } from "./_events";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const rawBody = await req.text();
  const { status, body } = await handleShopifyWebhook(
    rawBody,
    {
      topic: req.headers.get("x-shopify-topic"),
      shop: req.headers.get("x-shopify-shop-domain"),
      hmac: req.headers.get("x-shopify-hmac-sha256"),
    },
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
