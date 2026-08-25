import { bearer } from "./recovery";
import type { RetentionTouch } from "./retention";
export interface ReviewCampaignRecord{id:string;status:string;touch:RetentionTouch;review_link:string;buyer_count:number;created_at:string;review_deliveries?:{id:string;status:string;delivery_status?:string|null;error?:string|null}[]}
async function request(body:Record<string,unknown>){const token=await bearer();const res=await fetch("/api/review-campaign",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await res.json().catch(()=>({}))as{campaign?:ReviewCampaignRecord;campaigns?:ReviewCampaignRecord[];scheduled?:number;sentNow?:number;error?:string};if(!res.ok)throw new Error(data.error??"Review activity request failed.");return data;}
export const getReviewCampaignHistory=()=>request({action:"history"}).then(result=>result.campaigns??[]);
export const reviewCampaignAction=(campaignId:string,action:"approve"|"reject")=>request({campaignId,action});
