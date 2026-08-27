import { supabase } from "./auth";
import type { ShopifyActionProposal } from "./actions";

export interface ProductOpportunity {id:string;title:string;status:string;score:number;listingScore:number;units90:number;revenue90:number;abandoned30:number;soldOut:boolean;issues:string[];recommendation:"promote"|"improve"|"watch"|"archive_candidate";archiveEligible:boolean}
export interface ProductCollection {id:string;title:string;sortOrder:string;products:string[]}
export interface ProductManagerSnapshot {shop:string;scanned:number;listingAverage:number;needsWork:number;promote:number;archiveCandidates:number;signals:{orders:boolean;abandonedCheckouts:boolean;pageViews:false};products:ProductOpportunity[];collections?:ProductCollection[];latestResearch?:import("./hunt").HuntReport|null;agentHealth?:{observerHealthy:boolean;lastRun:string|null;lastOutcome:string|null;lastError:string|null};generatedAt:string}

async function token(){if(!supabase)throw new Error("Sign in first.");const {data}=await supabase.auth.getSession();if(!data.session?.access_token)throw new Error("Your session expired. Sign in again.");return data.session.access_token;}
async function request<T>(path:string,method:"GET"|"POST"="GET",body?:unknown):Promise<T>{const response=await fetch(path,{method,headers:{Authorization:`Bearer ${await token()}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>({})) as T&{error?:string};if(!response.ok)throw new Error(data.error??"Product Manager request failed.");return data;}
export const getProductManagerSnapshot=()=>request<ProductManagerSnapshot>("/api/product-manager-snapshot");
export const optimizeProductListing=(productId:string)=>request<{action:ShopifyActionProposal}>("/api/product-manager-optimize","POST",{productId});
export const prepareProductArchive=(productId:string,title:string)=>request<{action:ShopifyActionProposal}>("/api/product-manager-archive","POST",{productId,title});
export const proposeShopifyAction=(body:Record<string,unknown>)=>request<{action:ShopifyActionProposal}>("/api/action-propose","POST",body);
