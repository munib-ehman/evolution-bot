#!/usr/bin/env node
/** Create the single seat-based Polar manager product and sync its catalog ID. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dotenv={};
try{for(const line of readFileSync(fileURLToPath(new URL("../.env",import.meta.url)),"utf8").split(/\r?\n/)){const match=/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);if(match)dotenv[match[1]]=match[2].replace(/^["']|["']$/g,"");}}catch{/* shell env only */}
const envVar=(name)=>(process.env[name]??dotenv[name]??"").trim();
const API_BASE=envVar("POLAR_API_BASE")||"https://api.polar.sh";
const TOKEN=envVar("POLAR_ACCESS_TOKEN");
const SUPABASE_URL=envVar("SUPABASE_URL")||envVar("VITE_SUPABASE_URL");
const SUPABASE_KEY=envVar("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_URL=process.argv[2]??"https://www.runevolution.io/api/polar-webhook";
const EVENTS=["subscription.active","subscription.updated","subscription.revoked"];
const PLANS=[
  ["marketing","Marketing Manager","Recovers carts and runs campaigns."],
  ["customer-success","Customer Success Manager","Runs support and retention workflows."],
  ["seo","SEO Manager","Improves SEO and GEO visibility."],
  ["product","Product Manager","Researches and improves merchandising."],
  ["operations","Operations Manager","Monitors fulfillment and operational risk."],
];
if(!TOKEN)throw new Error("Set POLAR_ACCESS_TOKEN first.");
if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");

async function polar(method,path,body){const response=await fetch(`${API_BASE}${path}`,{method,headers:{Authorization:`Bearer ${TOKEN}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const text=await response.text();if(!response.ok)throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0,500)}`);return text?JSON.parse(text):{};}
async function ensureProduct(){const listed=await polar("GET","/v1/products/?is_archived=false&limit=100");const existing=(listed.items??[]).find(product=>product.metadata?.manager_seat_product===true||product.name==="Evolution Managers");if(existing){if(!(existing.prices??[]).some(price=>price.amount_type==="seat_based"))throw new Error('"Evolution Managers" exists but is not seat-based. Archive it, enable Polar seat-based pricing, and rerun.');console.log(`✓ Seat product already exists (${existing.id})`);return existing.id;}const created=await polar("POST","/v1/products/",{name:"Evolution Managers",description:"Choose the AI managers your ecommerce store needs. Each manager is $50 per month.",recurring_interval:"month",metadata:{manager_seat_product:true},prices:[{amount_type:"seat_based",price_currency:"usd",seat_tiers:{seat_tier_type:"volume",tiers:[{min_seats:1,max_seats:5,price_per_seat:5000}]}}]});console.log(`✓ Created Evolution Managers at $50/manager/month (${created.id})`);return created.id;}
async function savePlans(productId){
  const headers={apikey:SUPABASE_KEY,...(SUPABASE_KEY.startsWith("sb_secret_")?{}:{Authorization:`Bearer ${SUPABASE_KEY}`}),"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"};
  const rows=PLANS.map(([role,name,description])=>({role,name,description,price_cents:5000,currency:"usd",billing_interval:"month",polar_product_id:productId,active:true,updated_at:new Date().toISOString()}));
  const response=await fetch(`${SUPABASE_URL}/rest/v1/manager_plans?on_conflict=role`,{method:"POST",headers,body:JSON.stringify(rows)});
  if(!response.ok){
    const detail=(await response.text()).slice(0,500);
    if(response.status===409&&detail.includes("manager_plans_polar_product_id_key"))throw new Error("The old manager_plans product-ID constraint is still installed. Run supabase/2026-08-19_manager_seat_billing.sql in the Supabase SQL Editor, then rerun this command.");
    throw new Error(`Supabase manager_plans upsert -> ${response.status}: ${detail}`);
  }
  console.log("✓ Synced manager catalog to Supabase");
}
async function ensureWebhook(){const listed=await polar("GET","/v1/webhooks/endpoints/?limit=100");const existing=(listed.items??[]).find(endpoint=>endpoint.url===WEBHOOK_URL);if(existing){const events=[...new Set([...(existing.events??[]),...EVENTS])];if(events.length!==(existing.events??[]).length)await polar("PATCH",`/v1/webhooks/endpoints/${existing.id}`,{events});console.log(`✓ Webhook ready (${existing.id})`);return existing.secret??null;}const created=await polar("POST","/v1/webhooks/endpoints/",{url:WEBHOOK_URL,format:"raw",events:EVENTS});console.log("✓ Webhook created");return created.secret??null;}

const productId=await ensureProduct();
await savePlans(productId);
const secret=await ensureWebhook();
console.log(`\nDone. One Polar subscription now bills $50 × selected managers.\nPOLAR_WEBHOOK_SECRET=${secret??"<copy or rotate in Polar Settings -> Webhooks>"}`);
