import { actionEnvFromProcess, runActionPropose, type ActionProposeBody } from "./_actions";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: ActionProposeBody;
  try { body = (await req.json()) as ActionProposeBody; }
  catch { return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  return runActionPropose(body, req.headers.get("authorization"), actionEnvFromProcess());
}
