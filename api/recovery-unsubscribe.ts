import { recoveryCampaignEnvFromProcess, runRecoveryUnsubscribe } from "./_recoveryCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return runRecoveryUnsubscribe(req, recoveryCampaignEnvFromProcess());
}
