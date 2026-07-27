/**
 * /api/audit — the free store audit (the funnel entry).
 *
 * POST { url } → fetches the store's public storefront, runs the rule
 * checks, has the LLM write the prose, and returns the report JSON. Works
 * without login; if the client sends its Supabase access token we attribute
 * the saved audit to that user. All real logic lives in _audit.ts so the
 * dev server (dev-api.ts) runs the identical engine.
 *
 * GET is a health probe: 204 = reachable (the audit works even with no
 * GROQ_API_KEY — prose falls back to templates).
 */
import { runAudit } from "./_audit";
import { clientIpFrom } from "./_ratelimit";
// The full Shopify env (not just AuditEnv): the deep audit's getConnection
// needs the app creds to auto-refresh expiring Admin API tokens.
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let url: unknown;
  try {
    url = ((await req.json()) as { url?: unknown }).url;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { status, body } = await runAudit(
    url,
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
    clientIpFrom(req.headers),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
