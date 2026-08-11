import { supabase } from "./auth";
import type { ShopifyActionProposal } from "./actions";

export interface SeoProduct { id: string; title: string; status: string; seoScore: number; geoScore: number; issues: string[]; geoChecks: {label:string;passed:boolean;detail:string}[]; vendorName:string;productTypeName:string }
export interface TechnicalGeoCheck { id:string;label:string;passed:boolean;detail:string;fix:string|null }
export interface SeoSnapshot { shop: string; scanned: number; truncated: boolean; seoScore: number; geoScore: number; overallGeoScore:number; technicalGeo:{score:number;sampledProducts:number;checks:TechnicalGeoCheck[]}; needsWork: number; ready: number; products: SeoProduct[] }
export interface SeoKeywordCandidate { keyword:string; score:number; relevance:number; marketplace:number; intent:number; sources:string[] }
export interface SeoSourceStatus { source:"google_suggest"|"amazon"|"ebay"; status:"available"|"unavailable"; url:string; observations:number; detail?:string }
export interface SeoOptimizationResult { action:ShopifyActionProposal; keywords:SeoKeywordCandidate[]; sources:SeoSourceStatus[]; missingFacts:string[] }

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

export async function optimizeSeoProduct(productId: string, confirmedFacts: Record<string,string> = {}): Promise<SeoOptimizationResult> {
  if (!supabase) throw new Error("Sign in first.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  const response = await fetch("/api/seo-optimize", { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify({productId,confirmedFacts}) });
  const body = await response.json().catch(()=>({})) as SeoOptimizationResult & {error?:string};
  if (!response.ok) throw new Error(body.error ?? "Could not prepare the SEO optimization.");
  return body;
}
