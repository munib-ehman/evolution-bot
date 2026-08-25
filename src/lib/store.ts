/**
 * The owner's connected store, profile (plan), and latest audit — thin
 * Supabase reads/writes in the same tolerant style as chatLog.ts: everything
 * no-ops or returns null when auth isn't configured or something fails,
 * because a downed table must never break the app.
 */
import { supabase } from "./auth";

export interface ConnectedStore {
  id: string;
  url: string;
  platform: string | null;
}

export interface AuditFinding {
  id: string;
  title: string;
  impact: number;
  detail: string;
  evidence?: string[];
}

export interface AuditStats {
  currency: string | null;
  orders30: number;
  revenue30: number;
  aov: number | null;
  repeatRate: number | null;
  abandoned30: number;
  abandonedValue30: number;
}

/** Catalog stats from the public /products.json scan. */
export interface AuditCatalog {
  products: number;
  /** True when the 250-product cap was hit — the catalog is likely bigger. */
  capped: boolean;
  soldOut: number;
  thinDescriptions: number;
  noImages: number;
  avgImages: number | null;
  priceMin: number | null;
  priceMax: number | null;
}

export interface AuditReport {
  storeUrl: string;
  platform: string;
  score: number;
  summary: string;
  productCount: number | null;
  findings: AuditFinding[];
  /** True when the report used the authenticated Shopify (OAuth) data. */
  connected?: boolean;
  stats?: AuditStats;
  catalog?: AuditCatalog;
  /** What the scan covered and which tech it saw — the report's receipts. */
  scanned?: { pages: string[]; detected: string[] };
  /** Page-by-page verdicts for every URL the crawl fetched. */
  pages?: AuditPage[];
}

export interface AuditPage {
  path: string;
  kind: "homepage" | "product" | "collection" | "page" | "blog";
  title: string | null;
  issues: string[];
}

export type Plan = "free" | "operator";
export type ManagerRole = "marketing" | "customer-success" | "seo" | "product" | "operations";
export type Entitlements = Record<ManagerRole, boolean>;
export const EMPTY_ENTITLEMENTS: Entitlements = { marketing:false, "customer-success":false, seo:false, product:false, operations:false };

export interface CatalogItem {
  title: string;
  priceMin: number | null;
  priceMax: number | null;
  soldOut: boolean;
}

export interface StoreCatalog {
  total: number;
  products: CatalogItem[];
}

/** The audit funnel page stashes the report here for post-signup handoff. */
export const PENDING_AUDIT_KEY = "evolution-pending-audit";

export async function getStore(): Promise<ConnectedStore | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("stores").select("id, url, platform").maybeSingle();
    return (data as ConnectedStore | null) ?? null;
  } catch {
    return null;
  }
}

export async function connectStore(url: string, platform?: string): Promise<ConnectedStore | null> {
  if (!supabase) return null;
  try {
    const { data: session } = await supabase.auth.getSession();
    const user = session.session?.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from("stores")
      .upsert(
        { user_id: user.id, url, platform: platform ?? null },
        { onConflict: "user_id" },
      )
      .select("id, url, platform")
      .single();
    if (error) return null;
    return data as ConnectedStore;
  } catch {
    return null;
  }
}

/**
 * The connected store's slim live catalog (names + prices) from
 * /api/store-products — grounds the chat copilot in real products. Null when
 * signed out, not connected (409), or anything fails: the chat then simply
 * runs without a catalog block, never breaks.
 */
export async function getStoreCatalog(): Promise<StoreCatalog | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch("/api/store-products", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as StoreCatalog;
    return Array.isArray(body.products) ? body : null;
  } catch {
    return null;
  }
}

/** Create the free-plan profile row on first sign-in; harmless if it exists. */
export function ensureProfile(): void {
  if (!supabase) return;
  const client = supabase;
  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      if (!user) return;
      await client
        .from("profiles")
        .upsert(
          { user_id: user.id, email: user.email },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
    } catch (err) {
      console.warn("[store] failed to ensure profile:", err);
    }
  })();
}

export async function getPlan(): Promise<Plan> {
  if (!supabase) return "free";
  try {
    const { data } = await supabase.from("profiles").select("plan").maybeSingle();
    return data?.plan === "operator" ? "operator" : "free";
  } catch {
    return "free";
  }
}

export async function getEntitlements(): Promise<Entitlements> {
  if (!supabase) return { marketing:true, "customer-success":true, seo:true, product:true, operations:true };
  try {
    const [{ data: rows, error }, { data: profile }] = await Promise.all([
      supabase.from("role_entitlements").select("role,status").eq("status", "active"),
      supabase.from("profiles").select("plan").maybeSingle(),
    ]);
    if (error) return profile?.plan === "operator" ? { marketing:true, "customer-success":true, seo:true, product:true, operations:true } : { ...EMPTY_ENTITLEMENTS };
    const value={...EMPTY_ENTITLEMENTS};
    for(const row of rows??[]) if(row.role in value)value[row.role as ManagerRole]=true;
    return value;
  } catch { return { ...EMPTY_ENTITLEMENTS }; }
}

export async function getLatestAudit(): Promise<AuditReport | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("audits")
      .select("report")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.report as AuditReport | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Re-run the audit as the signed-in user so the saved row is attributed to
 * them (the funnel run was anonymous). Returns the fresh report.
 */
/** Like runAuditAsUser, but failures carry the server's actual reason. */
export async function runAuditAsUserVerbose(
  url: string,
): Promise<{ report: AuditReport | null; error: string | null }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch("/api/audit", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { report: null, error: body.error ?? `The audit couldn't run (error ${res.status}) — try again in a minute.` };
    }
    return { report: (await res.json()) as AuditReport, error: null };
  } catch {
    return { report: null, error: "Couldn't reach the audit service — check your connection and try again." };
  }
}

export async function runAuditAsUser(url: string): Promise<AuditReport | null> {
  return (await runAuditAsUserVerbose(url)).report;
}

/**
 * Audit-first save: the store row is only written once the audit actually
 * reached the URL, so a typo'd or admin URL can never get locked in. The
 * saved URL is the server's normalized one (e.g. admin.shopify.com/store/x
 * comes back as x.myshopify.com).
 */
export async function auditAndSaveStore(url: string): Promise<{
  store: ConnectedStore | null;
  report: AuditReport | null;
  error: string | null;
}> {
  const { report, error } = await runAuditAsUserVerbose(url);
  if (!report) {
    return { store: null, report: null, error: error ?? "We couldn't scan that URL — double-check it and try again." };
  }
  const store = await connectStore(report.storeUrl ?? url, report.platform);
  if (!store) return { store: null, report, error: "The audit ran, but saving your store failed — try again in a moment." };
  return { store, report, error: null };
}
