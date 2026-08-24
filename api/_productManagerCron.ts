import { actionEnvFromProcess, type ActionEnv } from "./_actions";
import { getConnection } from "./_shopify";
import { buildProductsDigest } from "./_skillTools";
import { prepareAutonomousProductDecision } from "./_productManager";

const headers=(env:ActionEnv)=>({apikey:env.serviceRoleKey??"",Authorization:`Bearer ${env.serviceRoleKey??""}`,"Content-Type":"application/json"});
const weekStart=()=>{const date=new Date();date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return date.toISOString().slice(0,10);};
async function hash(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");}

export async function runProductManagerWeekly(auth:string|null,env:ActionEnv):Promise<Response>{
  if(!env.cronSecret||auth!==`Bearer ${env.cronSecret}`)return Response.json({error:"Unauthorized."},{status:401});
  if(!env.supabaseUrl||!env.serviceRoleKey)return Response.json({error:"Storage is not configured."},{status:503});
  const response=await fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?access_token=not.is.null&select=user_id,shop_domain&limit=200`,{headers:headers(env)});
  if(!response.ok)return Response.json({error:"Could not load connected shops."},{status:502});
  const rows=await response.json() as {user_id:string;shop_domain:string}[];let saved=0,skipped=0,proposed=0,waiting=0,failed=0;
  for(const row of rows){
    const conn=await getConnection(env,row.user_id);if(!conn){skipped++;continue;}
    const digest=await buildProductsDigest(conn,100);if("error" in digest){skipped++;continue;}
    const products=digest.products as {id:string;title:string;descQuality:string;images:number;imagesNoAlt:number;tags:number;vendor:boolean;productType:boolean}[];
    const opportunities=products.filter(product=>product.descQuality!=="ok"||product.images<1||product.imagesNoAlt>0||product.tags<3||!product.vendor||!product.productType).map(product=>({id:product.id,title:product.title,reasons:[product.descQuality!=="ok"?`${product.descQuality} description`:"",product.images<1?"no images":"",product.imagesNoAlt>0?"missing alt text":"",product.tags<3?"weak tags":"",!product.vendor?"missing vendor":"",!product.productType?"missing product type":""].filter(Boolean)})).slice(0,30);
    const catalogHash=await hash(JSON.stringify(products.map(product=>[product.id,product.descQuality,product.images,product.imagesNoAlt,product.tags,product.vendor,product.productType])));
    const insert=await fetch(`${env.supabaseUrl}/rest/v1/product_manager_snapshots?on_conflict=user_id,shop_domain,week_start`,{method:"POST",headers:{...headers(env),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:row.user_id,shop_domain:row.shop_domain,week_start:weekStart(),catalog_hash:catalogHash,summary:digest.aggregate,opportunities})});
    if(insert.ok)saved++;else skipped++;
    try{const decision=await prepareAutonomousProductDecision(env,row.user_id);if(decision.outcome==="proposed")proposed++;else if(decision.outcome==="waiting_for_approval")waiting++;else if(decision.outcome==="failed")failed++;}
    catch{failed++;}
  }
  return Response.json({saved,skipped,proposed,waiting,failed,shops:rows.length});
}

export const productManagerCronEnv=actionEnvFromProcess;
