/**
 * Live store events, client side. Supabase Realtime (a WebSocket) streams
 * store_events inserts to the signed-in owner the instant a Shopify webhook
 * lands — RLS scopes the stream to their own rows. Consumers: app-level
 * popup toasts + browser notifications, and the Ops panel's live feed.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./auth";
import { bearer } from "./recovery";

export interface StoreEvent {
  id: string;
  type: string; // order.new | stock.out | stock.low | …
  title: string;
  detail: Record<string, unknown>;
  created_at: string;
}

/** The last N events, newest first (for the Ops panel's feed on open). */
export async function fetchRecentEvents(limit = 20): Promise<StoreEvent[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from("store_events")
      .select("id,type,title,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as StoreEvent[] | null) ?? [];
  } catch {
    return [];
  }
}

/**
 * Stream new events over the WebSocket. Returns an unsubscribe function.
 * Safe to call with auth disabled (no-op).
 */
export function subscribeToEvents(
  userId: string,
  onEvent: (event: StoreEvent) => void,
  channelName = "store-events",
): () => void {
  if (!supabase) return () => {};
  let channel: RealtimeChannel | null = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "store_events", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as StoreEvent;
        if (row?.id && row?.title) onEvent(row);
      },
    )
    .subscribe();
  return () => {
    if (channel) void supabase?.removeChannel(channel);
    channel = null;
  };
}

/**
 * Ask the server to register this deployment's Shopify webhooks (idempotent).
 * live:false with a reason when push can't work here (e.g. local dev).
 */
export async function enableLiveUpdates(): Promise<{ live: boolean; reason?: string }> {
  const token = await bearer();
  if (!token) return { live: false, reason: "Sign in first." };
  try {
    const res = await fetch("/api/ops-live", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      live?: boolean;
      reason?: string;
      error?: string;
    };
    if (!res.ok) return { live: false, reason: body.error ?? `Failed (${res.status}).` };
    return { live: body.live === true, reason: body.reason };
  } catch {
    return { live: false, reason: "Couldn't reach the server." };
  }
}
