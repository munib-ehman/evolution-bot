import { runBroadcastUnsubscribe } from "./_broadcastCampaigns";import{recoveryCampaignEnvFromProcess}from"./_recoveryCampaigns";
export const config={runtime:"edge"};export default async function handler(req:Request){return runBroadcastUnsubscribe(req,recoveryCampaignEnvFromProcess());}
