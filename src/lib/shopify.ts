/**
 * Client side of the Shopify connect flow. The browser only ever sees the
 * connection STATUS (shop domain) — the access token lives in a
 * service-role-only table and never leaves the server.
 */
import { supabase } from "./auth";

export interface ShopifyStatus {
  shop_domain: string;
  connected_at: string;
}

/** Is Shopify connect configured on the server at all? (Partner app keys set.) */
export async function shopifyConnectAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/shopify-auth", { method: "GET" });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** The signed-in owner's connection, or null. */
export async function getShopifyStatus(): Promise<ShopifyStatus | null> {
  if (!supabase) return null;
  try {
    // Column list matters: the table's grant only covers non-secret columns,
    // so a `select *` would be rejected outright.
    const { data } = await supabase
      .from("shopify_connections")
      .select("shop_domain, connected_at")
      .maybeSingle();
    return (data as ShopifyStatus | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sever the store: the server deletes the Shopify connection and the stores
 * row (service role — the browser has no destructive access). True on success.
 */
export async function disconnectShopify(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const res = await fetch("/api/shopify-disconnect", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Kick off OAuth: ask the server for Shopify's authorize URL and navigate
 * there. Returns an error message instead when something is off.
 */
export async function startShopifyConnect(shop: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch("/api/shopify-auth", {
      method: "POST",
      headers,
      body: JSON.stringify({ shop }),
    });
    const body = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !body.url) return body.error ?? "Couldn't start the Shopify connection.";
    window.location.href = body.url;
    return null;
  } catch {
    return "Couldn't start the Shopify connection.";
  }
}
