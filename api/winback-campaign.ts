import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runWinbackCampaignAction } from "./_winbackCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  return runWinbackCampaignAction(body, req.headers.get("authorization"), recoveryCampaignEnvFromProcess());
}
