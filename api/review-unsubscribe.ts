import { runReviewUnsubscribe } from "./_reviewCampaigns";
import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";

export const config={runtime:"edge"};
export default async function handler(req:Request){return runReviewUnsubscribe(req,recoveryCampaignEnvFromProcess());}
