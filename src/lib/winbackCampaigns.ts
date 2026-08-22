import { bearer } from "./recovery";
import type { RetentionTouch } from "./retention";

export interface WinbackCampaignProposal {
  id: string;
  status: "proposed";
  touches: RetentionTouch[];
  customerCount: number;
  lifetimeValue: number;
  currency: string | null;
  storeName: string;
  createdAt: string;
}
export interface WinbackCampaignRecord { id:string; status:string; touches:RetentionTouch[]; segment:string; customer_count:number; lifetime_value:number; currency:string|null; created_at:string; winback_deliveries?:{id:string;status:string;delivery_status?:string|null;error?:string|null}[] }

export async function winbackCampaignAction(campaignId: string, action: "approve" | "reject" | "pause" | "resume") {
  const token = await bearer();
  const res = await fetch("/api/winback-campaign", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, action }) });
  const data = await res.json().catch(() => ({})) as { campaign?: { status: string }; scheduled?: number; sentNow?: number; skipped?: number; failed?: number; testMode?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Win-back campaign action failed.");
  return data;
}
export async function getWinbackCampaignHistory():Promise<WinbackCampaignRecord[]>{const token=await bearer();const res=await fetch("/api/winback-campaign",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({action:"history"})});const data=await res.json().catch(()=>({}))as{campaigns?:WinbackCampaignRecord[];error?:string};if(!res.ok)throw new Error(data.error??"Could not load win-back activity.");return data.campaigns??[];}
