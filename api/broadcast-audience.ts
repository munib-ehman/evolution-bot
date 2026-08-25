import { runBroadcastAudience } from "./_broadcastCampaigns"; import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
export const config={runtime:"edge"};export default async function handler(req:Request){if(req.method!=="GET")return new Response("Method not allowed",{status:405});return runBroadcastAudience(req.headers.get("authorization"),recoveryCampaignEnvFromProcess());}
