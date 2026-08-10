import { supabase } from "./auth";

export interface SeoProduct { id: string; title: string; status: string; seoScore: number; geoScore: number; issues: string[] }
export interface SeoSnapshot { shop: string; scanned: number; truncated: boolean; seoScore: number; geoScore: number; needsWork: number; ready: number; products: SeoProduct[] }

export async function getSeoSnapshot(): Promise<SeoSnapshot> {
  if (!supabase) throw new Error("Sign in first.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  const response = await fetch("/api/seo-snapshot", { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as SeoSnapshot & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not load the SEO snapshot.");
  return body;
}
