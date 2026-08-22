import { recoveryCampaignEnvFromProcess, runRecoveryCampaignAction } from "./_recoveryCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  return runRecoveryCampaignAction(body, req.headers.get("authorization"), recoveryCampaignEnvFromProcess());
}
