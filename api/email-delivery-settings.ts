import { emailDeliveryEnvFromProcess, runEmailDeliveryCheck, runEmailDeliveryGet, runEmailDeliverySave, runEmailDeliveryTest } from "./_emailDelivery";

export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  const env = emailDeliveryEnvFromProcess();
  if (req.method === "GET") return runEmailDeliveryGet(req.headers.get("authorization"), env);
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "check") return runEmailDeliveryCheck(req.headers.get("authorization"), env);
    if (body.action === "test") return runEmailDeliveryTest(req.headers.get("authorization"), env);
    return runEmailDeliverySave(body, req.headers.get("authorization"), env);
  }
  return new Response("Method not allowed", { status: 405 });
}
