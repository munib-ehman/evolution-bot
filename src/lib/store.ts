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

export interface AuditReport {
  storeUrl: string;
  platform: string;
  score: number;
  summary: string;
  productCount: number | null;
  findings: AuditFinding[];
}

export type Plan = "free" | "operator";

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
export async function runAuditAsUser(url: string): Promise<AuditReport | null> {
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
    if (!res.ok) return null;
    return (await res.json()) as AuditReport;
  } catch {
    return null;
  }
}
