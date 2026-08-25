import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runMarketingWorker } from "./_marketingJobs";

export const config={runtime:"edge",maxDuration:60};
export default async function handler(req:Request){const env=recoveryCampaignEnvFromProcess();if(!env.cronSecret||req.headers.get("authorization")!==`Bearer ${env.cronSecret}`)return Response.json({error:"Unauthorized."},{status:401});return Response.json(await runMarketingWorker(env));}
