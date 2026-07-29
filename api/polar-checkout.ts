/**
 * POST /api/polar-checkout — mint a Polar hosted-checkout URL for the
 * signed-in caller (the web billing rail; Shopify-connected accounts are
 * refused with 409 and billed through Shopify App Pricing instead).
 * Logic lives in _polar.ts (dev-api runs the same engine).
 *
 * GET is a health probe: 204 = configured, 503 = Polar vars missing — the
 * upgrade panel uses it to decide between the checkout button and the
 * contact CTA.
 */
import { runPolarCheckout, polarEnvFromProcess, polarConfigured } from "./_polar";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const env = polarEnvFromProcess();

  if (req.method === "GET") {
    return new Response(null, { status: polarConfigured(env) ? 204 : 503 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { status, body } = await runPolarCheckout(
    req.headers.get("authorization"),
    new URL(req.url).origin,
    env,
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
