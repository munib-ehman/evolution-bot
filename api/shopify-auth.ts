/**
 * /api/shopify-auth — step 1 of the Shopify connect flow.
 *
 * POST { shop } with the owner's Supabase bearer token → { url } of
 * Shopify's authorize page (read plus approved-action scopes). The client navigates there;
 * Shopify sends the owner back to /api/shopify-callback. Logic lives in
 * _shopify.ts so dev-api.ts runs the identical flow.
 */
import { runShopifyAuthStart, shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const env = shopifyEnvFromProcess();
  if (req.method === "GET") {
    // Health probe: 204 = Shopify connect configured, 503 = keys missing.
    return new Response(null, { status: env.shopifyApiKey && env.shopifyApiSecret ? 204 : 503 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let shop: unknown;
  try {
    shop = ((await req.json()) as { shop?: unknown }).shop;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = new URL(req.url).origin;
  const { status, body } = await runShopifyAuthStart(
    shop,
    req.headers.get("authorization"),
    origin,
    env,
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
