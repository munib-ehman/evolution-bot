import { actionEnvFromProcess, runActionHistory } from "./_actions";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return runActionHistory(req.headers.get("authorization"), actionEnvFromProcess());
}
