import { bearer } from "./recovery";

export type DeliveryMode = "merchant_domain" | "merchant_resend" | "evolution_shared";
export interface EmailDeliverySettings {
  mode: DeliveryMode; status: "pending" | "verified" | "test_required" | "ready" | "error";
  sendingDomain: string | null; senderName: string; senderEmail: string; replyTo: string;
  dnsRecords: { record?: string; name?: string; type?: string; value?: string; priority?: number; status?: string }[];
  fallbackWarningAcknowledged: boolean; providerAccountConnected: boolean; testSentAt: string | null;
}
async function request(method: string, body?: unknown) {
  const token = await bearer();
  const res = await fetch("/api/email-delivery-settings", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({})) as { settings?: EmailDeliverySettings | null; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Email delivery setup failed.");
  return data.settings ?? null;
}
export const getEmailDeliverySettings = () => request("GET");
export const saveEmailDeliverySettings = (body: Record<string, unknown>) => request("POST", body);
export const checkEmailDeliveryDomain = () => request("POST", { action: "check" });
export const sendEmailDeliveryTest = () => request("POST", { action: "test" });
