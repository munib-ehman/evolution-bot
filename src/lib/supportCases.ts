import { bearer } from "./recovery";

export type SupportResolution = "investigating" | "ship_date" | "cancel_refund" | "custom";
export interface SupportNotification {
  id: string; order_id: string; order_name: string; status: "proposed" | "sent" | "resolved" | "failed";
  resolution: SupportResolution; subject: string; body: string; delivery_status?: string | null;
  sent_at?: string | null; resolved_at?: string | null; error?: string | null;
}
export interface SupportCase {
  id: string; name: string; createdAt: string; financialStatus: string; totalPrice: number;
  firstName: string; email: string; items: { title: string; qty: number }[]; notification: SupportNotification | null;
}

export type SupportOwner = "customer-success" | "operations";
async function request(role: SupportOwner, method: "GET" | "POST", body?: Record<string, unknown>) {
  const token = await bearer();
  const response = await fetch(`/api/support-cases?role=${encodeURIComponent(role)}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({})) as { cases?: SupportCase[]; notification?: SupportNotification; testMode?: boolean; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Customer support action failed.");
  return data;
}

export const getSupportCases = async (role: SupportOwner = "operations") => (await request(role, "GET")).cases ?? [];
export async function draftSupportEmail(roleOrOrderId:SupportOwner|string,orderIdOrResolution:string,resolutionOrDetail:string,detailMaybe?:string){const explicit=roleOrOrderId==="customer-success"||roleOrOrderId==="operations";const role:SupportOwner=explicit?roleOrOrderId:"operations";const orderId=explicit?orderIdOrResolution:roleOrOrderId;const resolution=(explicit?resolutionOrDetail:orderIdOrResolution) as SupportResolution;const detail=explicit?(detailMaybe??""):resolutionOrDetail;return (await request(role,"POST",{action:"draft",orderId,resolution,detail})).notification!;}
export const sendSupportEmail = async (role: SupportOwner, orderId: string, subject: string, body: string) => request(role, "POST", { action: "send", orderId, subject, body, approved: true });
export const resolveSupportCase = async (role: SupportOwner, orderId: string) => (await request(role, "POST", { action: "resolve", orderId })).notification!;
