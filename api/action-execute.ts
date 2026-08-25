import { actionEnvFromProcess, runActionExecute } from "./_actions";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let actionId: unknown;
  try { actionId = ((await req.json()) as { actionId?: unknown }).actionId; }
  catch { return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  return runActionExecute(actionId, req.headers.get("authorization"), actionEnvFromProcess());
}
