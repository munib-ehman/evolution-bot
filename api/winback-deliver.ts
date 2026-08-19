import { processWinbackDeliveries } from "./_winbackCampaigns";
import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request) {
  const env = recoveryCampaignEnvFromProcess();
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json(await processWinbackDeliveries(env));
}
