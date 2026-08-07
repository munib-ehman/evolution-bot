/**
 * /api/product-hunt — the free tier's winning-products hunt.
 *
 * POST { url } with the owner's Supabase bearer token. Streams SSE:
 * progress lines while the live web research runs, then {"report": …},
 * then [DONE]. All real logic lives in _productHunt.ts so the dev server
 * (dev-api.ts) runs the identical engine.
 *
 * GET is a health probe: 204 = reachable.
 */
import { runProductHunt } from "./_productHunt";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return runProductHunt(body, req.headers.get("authorization"), shopifyEnvFromProcess());
}
