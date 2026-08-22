import { runSeoOptimize, type SeoOptimizeBody } from "./_seoOptimizer";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };
export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: SeoOptimizeBody;
  try { body = await req.json() as SeoOptimizeBody; }
  catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  return runSeoOptimize(body, req.headers.get("authorization"), shopifyEnvFromProcess());
}
