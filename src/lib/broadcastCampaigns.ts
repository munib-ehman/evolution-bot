import { bearer } from "./recovery";
export type BroadcastSegment="subscribers"|"recent"|"repeat"|"vip"|"lapsed";
export interface BroadcastSegmentSummary{key:BroadcastSegment;count:number;lifetimeValue:number}
export interface BroadcastCampaign{ id:string;status:string;name:string;segment:BroadcastSegment;subject:string;body:string;scheduled_at:string;customer_count:number }
async function request(body:Record<string,unknown>){const token=await bearer();const res=await fetch("/api/broadcast-campaign",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await res.json().catch(()=>({}))as{campaign?:BroadcastCampaign;scheduled?:number;sentNow?:number;testMode?:boolean;error?:string};if(!res.ok)throw new Error(data.error??"Campaign request failed.");return data;}
export async function getBroadcastAudience(){const token=await bearer();const res=await fetch("/api/broadcast-audience",{headers:{Authorization:`Bearer ${token}`}});const data=await res.json().catch(()=>({}))as{segments?:BroadcastSegmentSummary[];currency?:string|null;error?:string};if(!res.ok)throw new Error(data.error??"Could not load marketing subscribers.");return{segments:data.segments??[],currency:data.currency??null};}
export const createBroadcastCampaign=(input:{name:string;segment:BroadcastSegment;subject:string;body:string;scheduledAt:string})=>request({action:"create",...input});
export const broadcastCampaignAction=(campaignId:string,action:"approve"|"reject")=>request({campaignId,action});
