import { actionEnvFromProcess, runActionUpdate } from "./_actions";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: { actionId?: unknown; items?: unknown };
  try { body = await req.json() as { actionId?: unknown; items?: unknown }; }
  catch { return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  return runActionUpdate(body.actionId, body.items, req.headers.get("authorization"), actionEnvFromProcess());
}
