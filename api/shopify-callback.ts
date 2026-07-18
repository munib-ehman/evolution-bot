/**
 * /api/shopify-callback — step 2 of the Shopify connect flow.
 *
 * Shopify redirects the owner here with code+hmac+state after they approve
 * the read-only scopes. We verify Shopify's HMAC and our signed state, swap
 * the code for an access token, store it server-side, and bounce the owner
 * back into /app. Logic lives in _shopify.ts (shared with dev-api.ts).
 */
import { runShopifyCallback, shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { redirect } = await runShopifyCallback(new URL(req.url), shopifyEnvFromProcess());
  return new Response(null, { status: 302, headers: { Location: redirect } });
}
