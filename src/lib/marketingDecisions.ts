import { bearer } from "./recovery";

export interface DecisionExplanation{
  decision:string;evidence:string[];expectedOutcome:string;risks:string[];safeguards:string[];afterApproval:string;strategy:Record<string,unknown>;
}
export interface MarketingActivity{
  id:string;kind:"recovery"|"winback"|"review"|"broadcast";legacy_table:string;legacy_id:string;status:string;title:string;
  audience:{count?:number;value?:number};strategy:Record<string,unknown>;evidence:Record<string,unknown>;safety_snapshot:{profileReady?:boolean};
  expected_revenue_low:number|null;expected_revenue_high:number|null;expected_profit_low:number|null;expected_profit_high:number|null;confidence:number;
  expires_at:string|null;created_at:string;explanation:DecisionExplanation;
  marketing_activity_variants?:{id:string;label:string;subject:string;body:string;allocation_percent:number;is_holdout:boolean;status:string}[];
}
export interface MarketingHealth{profileReady:boolean;workerHealthy:boolean;lastHeartbeat:string|null;pendingJobs:number;runningJobs:number;deadJobs:number;lastError:string|null}
export interface MarketingStatus{activities:MarketingActivity[];health:MarketingHealth}
export async function getMarketingStatus():Promise<MarketingStatus>{const token=await bearer();if(!token)throw new Error("Sign in first.");const response=await fetch("/api/marketing-decisions",{headers:{Authorization:`Bearer ${token}`}}),data=await response.json().catch(()=>({}))as Partial<MarketingStatus>&{error?:string};if(!response.ok)throw new Error(data.error??"Could not load marketing activity.");return{activities:data.activities??[],health:data.health??{profileReady:false,workerHealthy:false,lastHeartbeat:null,pendingJobs:0,runningJobs:0,deadJobs:0,lastError:"Agent health is unavailable."}};}
