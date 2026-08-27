import { recoveryCampaignEnvFromProcess, runResendWebhook } from "./_recoveryCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return runResendWebhook(req, recoveryCampaignEnvFromProcess());
}
