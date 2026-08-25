import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { enqueueMarketingCycle, runMarketingWorker } from "./_marketingJobs";
export const config = { runtime: "edge", maxDuration: 60 };
export default async function handler(req: Request): Promise<Response> {
  const env = recoveryCampaignEnvFromProcess();
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try{const queued=await enqueueMarketingCycle(env),worker=await runMarketingWorker(env,"marketing-observer");return Response.json({queued,...worker});}
  catch(error){return Response.json({error:String(error)},{status:502});}
}
