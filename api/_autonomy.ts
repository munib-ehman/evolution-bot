import { resolveUserFull } from "./_audit";
import type { ActionEnv } from "./_actions";
import { getEntitlements,type Role } from "./_plan";

export type DailyPace="light"|"balanced"|"active";
interface AutonomyContract{user_id:string;max_actions_per_day:number;daily_digest:boolean;setup_complete:boolean;version:number}
const defaults:Omit<AutonomyContract,"user_id">={max_actions_per_day:5,daily_digest:true,setup_complete:false,version:1};
const headers=(env:ActionEnv,representation=false)=>({apikey:env.serviceRoleKey??"",Authorization:`Bearer ${env.serviceRoleKey??""}`,"Content-Type":"application/json",Prefer:representation?"return=representation":"return=minimal"});
const paceLimits:Record<DailyPace,number>={light:2,balanced:5,active:10};
const watchingByRole:Record<Role,string[]>={
  marketing:["Recovery, win-back, review, and broadcast opportunities"],
  "customer-success":["Customer retention, reviews, and support risks"],
  seo:["Catalog search visibility and product metadata"],
  product:["Catalog health, listing quality, and product opportunities"],
  operations:["Orders, fulfillment delays, and inventory risks"],
};

async function contractFor(env:ActionEnv,userId:string):Promise<AutonomyContract>{
  const response=await fetch(`${env.supabaseUrl}/rest/v1/autonomy_contracts?user_id=eq.${userId}&select=*&limit=1`,{headers:headers(env)}).catch(()=>null);
  const row=response?.ok?(await response.json() as Partial<AutonomyContract>[])[0]:null;
  return{user_id:userId,...defaults,...row};
}

const preparedTables=["shopify_actions","marketing_activities","support_notifications"] as const;
async function preparedToday(env:ActionEnv,userId:string,table:string):Promise<number>{
  const since=new Date();since.setUTCHours(0,0,0,0);
  const response=await fetch(`${env.supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(since.toISOString())}&select=id&limit=1`,{method:"HEAD",headers:{...headers(env),Prefer:"count=exact"}}).catch(()=>null);
  if(!response?.ok)return 0;
  const total=Number(response.headers.get("content-range")?.split("/")[1]??0);
  return Number.isFinite(total)?total:0;
}

/** Shared daily budget for work prepared automatically across every manager.
 * Counts approval-ready Shopify, marketing, and support items in one queue. */
export async function autopilotAllowance(env:ActionEnv,userId:string):Promise<{limit:number;used:number;remaining:number}>{
  if(!env.supabaseUrl||!env.serviceRoleKey)return{limit:defaults.max_actions_per_day,used:0,remaining:defaults.max_actions_per_day};
  const [contract,...counts]=await Promise.all([contractFor(env,userId),...preparedTables.map(table=>preparedToday(env,userId,table))]);
  const used=counts.reduce((sum,count)=>sum+count,0),limit=contract.max_actions_per_day;
  return{limit,used,remaining:Math.max(0,limit-used)};
}

export async function runAutonomy(req:Request,env:ActionEnv):Promise<Response>{
  const user=await resolveUserFull(env,req.headers.get("authorization"));
  if(!user)return Response.json({error:"Sign in first."},{status:401});
  if(!env.supabaseUrl||!env.serviceRoleKey)return Response.json({error:"Autopilot storage is not configured."},{status:503});
  if(req.method==="GET"){
    const [stored,entitlements,allowance]=await Promise.all([contractFor(env,user.id),getEntitlements(env,user.id,user.email),autopilotAllowance(env,user.id)]);
    const daily_pace:DailyPace=stored.max_actions_per_day<=2?"light":stored.max_actions_per_day>=10?"active":"balanced";
    const watching=(Object.keys(entitlements) as Role[]).filter(role=>entitlements[role]).flatMap(role=>watchingByRole[role]);
    return Response.json({contract:{user_id:user.id,daily_pace,max_actions_per_day:stored.max_actions_per_day,prepared_today:allowance.used,daily_digest:stored.daily_digest,setup_complete:stored.setup_complete},watching});
  }
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  const dailyPace=["light","balanced","active"].includes(String(body.daily_pace))?String(body.daily_pace) as DailyPace:"balanced",limit=paceLimits[dailyPace];
  const payload={user_id:user.id,max_actions_per_day:limit,daily_digest:body.daily_digest!==false,setup_complete:true,version:1,updated_at:new Date().toISOString()};
  const saved=await fetch(`${env.supabaseUrl}/rest/v1/autonomy_contracts?on_conflict=user_id&select=*`,{method:"POST",headers:headers(env,true),body:JSON.stringify(payload)});
  if(!saved.ok)return Response.json({error:"Could not save Autopilot settings. Apply the Autopilot migration first."},{status:502});
  const allowance=await autopilotAllowance(env,user.id);
  return Response.json({contract:{user_id:user.id,daily_pace:dailyPace,max_actions_per_day:limit,prepared_today:allowance.used,daily_digest:body.daily_digest!==false,setup_complete:true}});
}
