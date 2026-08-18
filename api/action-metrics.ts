import { actionEnvFromProcess, runActionMetrics } from "./_actions";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return runActionMetrics(req.headers.get("authorization"), actionEnvFromProcess());
}
