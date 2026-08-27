import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runMarketingStatus } from "./_marketingStatus";

export const config={runtime:"edge"};
export default async function handler(req:Request){return runMarketingStatus(req,recoveryCampaignEnvFromProcess());}
