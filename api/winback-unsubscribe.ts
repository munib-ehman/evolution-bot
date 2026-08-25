import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runWinbackUnsubscribe } from "./_winbackCampaigns";
export const config = { runtime: "edge" };
export default async function handler(req: Request) { return runWinbackUnsubscribe(req, recoveryCampaignEnvFromProcess()); }
