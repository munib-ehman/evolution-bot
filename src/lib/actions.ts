import { supabase } from "./auth";

export type ShopifyActionKind =
  | "product_update"
  | "product_status_update"
  | "product_draft_create"
  | "collection_upsert"
  | "discount_code_create"
  | "discount_automatic_create";
export type ShopifyActionStatus =
  | "proposed" | "executing" | "succeeded" | "partial" | "failed"
  | "stale" | "undone" | "expired" | "rejected";

export interface ShopifyActionMetric {
  window_days: number;
  metrics: Record<string, unknown>;
  measured_at: string;
}

export interface ShopifyActionProposal {
  id: string;
  kind: ShopifyActionKind;
  status: ShopifyActionStatus;
  summary: string;
  payload: Record<string, unknown>;
  before_state: Record<string, unknown>;
  after_state?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  expires_at: string;
  executed_at?: string | null;
  created_at: string;
  shopify_action_metrics?: ShopifyActionMetric[];
}

async function bearer(): Promise<string> {
  if (!supabase) throw new Error("Sign in first.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token;
}

async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
  const token = await bearer();
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Action request failed (${res.status}).`);
  return data;
}

export async function executeAction(actionId: string): Promise<ShopifyActionProposal> {
  const data = await request("/api/action-execute", "POST", { actionId }) as { action: ShopifyActionProposal };
  return data.action;
}

export async function updateAction(actionId: string, items: unknown[]): Promise<ShopifyActionProposal> {
  const data = await request("/api/action-update", "POST", { actionId, items }) as { action: ShopifyActionProposal };
  return data.action;
}

export async function rejectAction(actionId: string): Promise<ShopifyActionProposal> {
  const data = await request("/api/action-reject", "POST", { actionId }) as { action: ShopifyActionProposal };
  return data.action;
}

export async function undoAction(actionId: string): Promise<ShopifyActionProposal> {
  const data = await request("/api/action-undo", "POST", { actionId }) as { action: ShopifyActionProposal };
  return data.action;
}

export async function fetchActionHistory(): Promise<ShopifyActionProposal[]> {
  const data = await request("/api/action-history", "GET") as { actions: ShopifyActionProposal[] };
  return data.actions;
}

