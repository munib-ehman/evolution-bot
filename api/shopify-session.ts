/**
 * POST /api/shopify-session — embedded-app auto-login. The SPA (running
 * inside the Shopify admin) posts its App Bridge session token; we verify it,
 * make sure the store is connected (token exchange on fresh installs), and
 * answer with a Supabase magic-link token_hash the client redeems via
 * supabase.auth.verifyOtp. Engine lives in _embedded.ts (dev-api runs the
 * same one). No bearer auth — the session token IS the credential.
 */
import { runShopifySession } from "./_embedded";
import { shopifyEnvFromProcess } from "./_shopify";
import { polarEnvFromProcess } from "./_polar";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body: { sessionToken?: unknown };
  try {
    body = (await req.json()) as { sessionToken?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { status, body: result } = await runShopifySession(body, shopifyEnvFromProcess(), polarEnvFromProcess());
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
