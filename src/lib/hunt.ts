/**
 * Product-hunt client — runs /api/product-hunt (SSE) and reads the owner's
 * saved hunts from Supabase. Types mirror api/_productHunt.ts exactly.
 */
import { supabase } from "./auth";

export interface HuntStat {
  label: string;
  value: string;
}
export interface HuntSourcing {
  supplier: string;
  searchTerm: string;
  url?: string;
  unitCost?: string;
}
export interface HuntSource {
  title: string;
  url: string;
}
export interface HuntListing {
  title: string;
  price: string;
  bullets: string[];
  description: string;
}
export interface HuntProduct {
  name: string;
  hook: string;
  whyWinning: string;
  stats: HuntStat[];
  sourcing: HuntSourcing[];
  listing: HuntListing;
  fit: string;
  sources: HuntSource[];
}
export interface HuntReport {
  storeUrl: string;
  niche: string;
  audience: string;
  summary: string;
  products: HuntProduct[];
  generatedAt: string;
}

/** The owner's most recent saved hunt, or null (signed out / none yet). */
export async function getLatestHunt(storeUrl: string): Promise<HuntReport | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("product_hunts")
      .select("report")
      .eq("store_url", storeUrl)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.report as HuntReport | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Run a hunt. `onProgress` receives the server's status lines while the live
 * research runs (expect ~30-60 seconds). Resolves with the report or the
 * server's actual error message.
 */
export async function runProductHunt(
  url: string,
  onProgress: (text: string) => void,
): Promise<{ report: HuntReport | null; error: string | null }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch("/api/product-hunt", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });

    // Non-SSE responses are immediate failures (401/429/503…).
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { report: null, error: body?.error ?? "The hunt couldn't start — try again in a minute." };
    }
    if (!res.body) return { report: null, error: "The hunt couldn't start — try again in a minute." };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let report: HuntReport | null = null;
    let error: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as { progress?: string; report?: HuntReport; error?: string };
          if (evt.progress) onProgress(evt.progress);
          if (evt.report) report = evt.report;
          if (evt.error) error = evt.error;
        } catch {
          /* partial frame — ignore */
        }
      }
    }

    if (report) return { report, error: null };
    return { report: null, error: error ?? "The hunt didn't finish — try again in a minute." };
  } catch {
    return { report: null, error: "Couldn't reach the hunt service — check your connection and try again." };
  }
}
