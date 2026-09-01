import type { RecoveryCampaignEnv } from "./_recoveryCampaigns";
import { detectRecoveryOpportunities } from "./_recoveryCampaigns";
import { detectWinbackOpportunities } from "./_winbackCampaigns";
import { detectBroadcastOpportunities } from "./_broadcastCampaigns";
import { detectReviewOpportunities } from "./_reviewCampaigns";
import { detectCustomerSuccessRisks } from "./_supportCases";
import { prepareAutonomousProductDecision } from "./_productManager";
import { autopilotAllowance } from "./_autonomy";

type Job={id:string;kind:string;user_id?:string|null;payload?:Record<string,unknown>;attempt_count:number;max_attempts:number};
const headers=(env:RecoveryCampaignEnv)=>{const key=env.serviceRoleKey??"";return{apikey:key,...(key.startsWith("sb_secret_")?{}:{Authorization:`Bearer ${key}`}),"Content-Type":"application/json","User-Agent":"EvolutionBackend/1.0"}};
export async function connectedShops(env:RecoveryCampaignEnv){const response=await fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?access_token=not.is.null&select=user_id,shop_domain&limit=500`,{headers:headers(env)});if(!response.ok)throw new Error("Could not load connected stores.");return response.json()as Promise<{user_id:string;shop_domain:string}[]>;}
export async function enqueueMarketingCycle(env:RecoveryCampaignEnv){const bucket=new Date().toISOString().slice(0,13),base=["observe_support","observe_recovery","observe_winback","observe_review","observe_broadcast"].map((kind,index)=>({kind,payload:{trigger:"hourly"},priority:10+index,idempotency_key:`${kind}:${bucket}`})),shops=await connectedShops(env),product=shops.map((shop,index)=>({user_id:shop.user_id,kind:"observe_product",payload:{shopDomain:shop.shop_domain,trigger:"hourly"},priority:30+index,idempotency_key:`observe_product:${shop.user_id}:${bucket}`})),jobs=[...base,...product],response=await fetch(`${env.supabaseUrl}/rest/v1/marketing_jobs?on_conflict=idempotency_key`,{method:"POST",headers:{...headers(env),Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(jobs)});if(!response.ok)throw new Error("Could not enqueue agent jobs.");return jobs.length;}
async function finish(env:RecoveryCampaignEnv,job:Job,ok:boolean,error?:string){const dead=!ok&&job.attempt_count>=job.max_attempts,status=ok?"completed":dead?"dead":"queued",delay=Math.min(3600,Math.pow(2,Math.max(1,job.attempt_count))*60),patch={status,lease_owner:null,lease_until:null,last_error:error??null,completed_at:ok?new Date().toISOString():null,run_at:ok?new Date().toISOString():new Date(Date.now()+delay*1000).toISOString(),updated_at:new Date().toISOString()},response=await fetch(`${env.supabaseUrl}/rest/v1/marketing_jobs?id=eq.${job.id}`,{method:"PATCH",headers:headers(env),body:JSON.stringify(patch)});if(!response.ok)throw new Error(`Could not persist ${job.kind} job state.`);}
async function shopsWithAutopilotRoom(env:RecoveryCampaignEnv,shops:{user_id:string;shop_domain:string}[]){const checks=await Promise.all(shops.map(async shop=>({shop,allowance:await autopilotAllowance(env,shop.user_id)})));return checks.filter(item=>item.allowance.remaining>0).map(item=>item.shop);}
export async function runMarketingWorker(env:RecoveryCampaignEnv,worker="marketing-worker"){
  const started=new Date().toISOString(),heartbeat=await fetch(`${env.supabaseUrl}/rest/v1/marketing_worker_heartbeats?on_conflict=worker`,{method:"POST",headers:{...headers(env),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({worker,last_started_at:started,updated_at:started})});if(!heartbeat.ok)throw new Error("Could not record the marketing worker heartbeat.");
  const claimed=await fetch(`${env.supabaseUrl}/rest/v1/rpc/claim_marketing_jobs`,{method:"POST",headers:headers(env),body:JSON.stringify({p_worker:worker,p_limit:12})});if(!claimed.ok)throw new Error("Could not claim marketing jobs.");
  const jobs=await claimed.json()as Job[];let completed=0,failed=0;let shops:{user_id:string;shop_domain:string}[]|null=null;
  for(const job of jobs){try{
    if(job.kind==="observe_product"){
      if(!job.user_id)throw new Error("Product observer job has no owner.");
      if((await autopilotAllowance(env,job.user_id)).remaining>0)await prepareAutonomousProductDecision(env,job.user_id);
    }else{
      shops??=await connectedShops(env);
      const eligible=await shopsWithAutopilotRoom(env,shops);
      if(job.kind==="observe_support")await detectCustomerSuccessRisks(env,eligible);
      else if(job.kind==="observe_recovery")await detectRecoveryOpportunities(env,eligible);
      else if(job.kind==="observe_winback")await detectWinbackOpportunities(env,eligible);
      else if(job.kind==="observe_review")await detectReviewOpportunities(env,eligible);
      else if(job.kind==="observe_broadcast")await detectBroadcastOpportunities(env,eligible);
      else throw new Error(`Unknown job kind: ${job.kind}`);
    }
    await finish(env,job,true);completed++;
  }catch(error){try{await finish(env,job,false,String(error));}finally{failed++;}}}
  const now=new Date().toISOString(),updated=await fetch(`${env.supabaseUrl}/rest/v1/marketing_worker_heartbeats?worker=eq.${encodeURIComponent(worker)}`,{method:"PATCH",headers:headers(env),body:JSON.stringify({last_succeeded_at:failed===0?now:null,last_failed_at:failed?now:null,last_error:failed?`${failed} job(s) failed`:null,processed:jobs.length,updated_at:now})});if(!updated.ok)throw new Error("Could not finalize the marketing worker heartbeat.");return{worker,claimed:jobs.length,completed,failed};
}
