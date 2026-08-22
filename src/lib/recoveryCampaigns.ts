import { bearer } from "./recovery";

export interface RecoveryCampaignActionResult {
  campaign: { id: string; status: string; approved_at?: string };
  scheduled?: number; sentNow?: number; skipped?: number; failed?: number; testMode?: boolean;
}
export interface RecoveryDeliveryRecord { id: string; touch_index: number; due_at: string; status: "queued" | "processing" | "sent" | "skipped" | "failed" | "cancelled"; delivery_status?: string | null; error?: string | null; sent_at?: string | null; delivered_at?: string | null; opened_at?: string | null; clicked_at?: string | null; bounced_at?: string | null; complained_at?: string | null; unsubscribed_at?: string | null; resend_email_id?: string | null }
export interface RecoveryCampaignRecord { id: string; status: "proposed" | "scheduled" | "paused" | "rejected" | "completed" | "failed"; touches: { delayLabel: string; subject: string; body: string }[]; cart_count: number; total_value: number; currency: string | null; approved_at?: string | null; completed_at?: string | null; created_at: string; recovery_deliveries: RecoveryDeliveryRecord[] }
export async function recoveryCampaignAction(campaignId: string, action: "approve" | "reject" | "pause" | "resume"): Promise<RecoveryCampaignActionResult> {
  const token = await bearer();
  const res = await fetch("/api/recovery-campaign", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, action }) });
  const data = await res.json().catch(() => ({})) as RecoveryCampaignActionResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Campaign action failed.");
  return data;
}
export async function getRecoveryCampaignHistory(): Promise<RecoveryCampaignRecord[]> {
  const token = await bearer();
  const res = await fetch("/api/recovery-campaign", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "history" }) });
  const data = await res.json().catch(() => ({})) as { campaigns?: RecoveryCampaignRecord[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not load recovery campaigns.");
  return data.campaigns ?? [];
}
export async function observeRecoveryOpportunities():Promise<void>{const token=await bearer();const res=await fetch("/api/recovery-campaign",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({action:"observe"})});if(!res.ok){const data=await res.json().catch(()=>({}))as{error?:string};throw new Error(data.error??"Could not refresh recovery opportunities.");}}
