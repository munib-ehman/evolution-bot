import { recoveryCampaignEnvFromProcess, runRecoveryCron } from "./_recoveryCampaigns";
export const config = { runtime: "edge", maxDuration: 60 };
export default async function handler(req: Request): Promise<Response> {
  return runRecoveryCron(req, recoveryCampaignEnvFromProcess());
}
