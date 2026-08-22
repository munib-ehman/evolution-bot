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

export async function winbackCampaignAction(campaignId: string, action: "approve" | "reject" | "pause" | "resume") {
  const token = await bearer();
  const res = await fetch("/api/winback-campaign", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, action }) });
  const data = await res.json().catch(() => ({})) as { campaign?: { status: string }; scheduled?: number; sentNow?: number; skipped?: number; failed?: number; testMode?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Win-back campaign action failed.");
  return data;
}
