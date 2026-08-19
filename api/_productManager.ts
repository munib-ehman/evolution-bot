import { resolveUserFull } from "./_audit";
import { runActionPropose, type ShopifyActionRow } from "./_actions";
import { hasRole, roleRequired } from "./_plan";
import { getConnection, shopifyGraphql, type ShopifyConnection, type ShopifyEnv } from "./_shopify";
import { buildProductsDigest } from "./_skillTools";
import { fetchAbandonedCheckoutsWindow, fetchOrdersWindow } from "./_shopifyData";
import { GROQ_BASE } from "./_shared";
import { buildKeywordCandidates, collectEvidence, extractCatalogFacts, sourceUrl } from "./_seoOptimizer";
import { reportFitsCatalog, type HuntReport } from "./_productHunt";

type DigestProduct = {
  id:string; title:string; status:string; descChars:number; descQuality:string; images:number; imagesNoAlt:number;
  soldOut:boolean; tags:number; vendor:boolean; productType:boolean; vendorName?:string; productTypeName?:string;
  priceMin:number|null; priceMax:number|null;
  createdAt?:string;
};

export interface ProductOpportunity {
  id:string; title:string; status:string; score:number; listingScore:number; units90:number; revenue90:number;
  abandoned30:number; soldOut:boolean; issues:string[]; recommendation:"promote"|"improve"|"watch"|"archive_candidate";
  archiveEligible:boolean;
}

async function latestResearch(env:ShopifyEnv,userId:string,shopDomain:string):Promise<unknown|null>{
  if(!env.supabaseUrl||!env.serviceRoleKey)return null;
  const headers={apikey:env.serviceRoleKey,Authorization:`Bearer ${env.serviceRoleKey}`};
  const current=await fetch(`${env.supabaseUrl}/rest/v1/product_research_runs?user_id=eq.${encodeURIComponent(userId)}&shop_domain=eq.${encodeURIComponent(shopDomain)}&status=eq.completed&select=report&order=created_at.desc&limit=1`,{headers}).catch(()=>null);
  if(current?.ok){const rows=await current.json() as {report?:unknown}[];if(rows[0]?.report)return rows[0].report;}
  const legacy=await fetch(`${env.supabaseUrl}/rest/v1/product_hunts?user_id=eq.${encodeURIComponent(userId)}&select=report&order=created_at.desc&limit=10`,{headers}).catch(()=>null);
  if(legacy?.ok){
    const rows=await legacy.json() as {report?:{storeUrl?:unknown}}[];
    const match=rows.find(row=>{try{return typeof row.report?.storeUrl==="string"&&new URL(row.report.storeUrl).host===shopDomain;}catch{return false;}});
    if(match?.report)return match.report;
  }
  return null;
}

const clean = (value:unknown,max=500) => (typeof value === "string" ? value : "").replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const strip = (value:string) => value.replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
const validId = (value:unknown) => typeof value === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(value) ? value : null;

export function listingScore(product:DigestProduct):number {
  let score=0;
  if(product.title.length>=12) score+=15;
  if(product.descChars>=200) score+=30; else if(product.descChars>0) score+=12;
  if(product.images>=3) score+=20; else if(product.images>0) score+=10;
  if(product.images>0&&product.imagesNoAlt===0) score+=10;
  if(product.tags>=3) score+=10;
  if(product.vendor) score+=7;
  if(product.productType) score+=8;
  return score;
}

async function salesSignals(conn:ShopifyConnection) {
  const [orders,checkouts] = await Promise.all([fetchOrdersWindow(conn,90,{lineItems:true}),fetchAbandonedCheckoutsWindow(conn,30)]);
  const byTitle=new Map<string,{units:number;revenue:number}>();
  for(const order of orders??[]) for(const item of order.lineItems){
    const key=item.title.trim().toLowerCase(), row=byTitle.get(key)??{units:0,revenue:0};
    row.units+=item.quantity; row.revenue+=item.quantity*item.price; byTitle.set(key,row);
  }
  const abandoned=new Map<string,number>();
  for(const checkout of checkouts??[]) for(const item of checkout.items){
    const key=item.title.trim().toLowerCase(); abandoned.set(key,(abandoned.get(key)??0)+item.qty);
  }
  return {byTitle,abandoned,ordersAvailable:Boolean(orders),checkoutsAvailable:Boolean(checkouts)};
}

export async function productManagerSnapshot(authHeader:string|null,env:ShopifyEnv):Promise<Response>{
  const user=await resolveUserFull(env,authHeader);
  if(!user) return Response.json({error:"Sign in first."},{status:401});
  if(!(await hasRole(env,user.id,"product",user.email))) { const denied=roleRequired("product"); return Response.json(denied.body,{status:denied.status}); }
  const conn=await getConnection(env,user.id);
  if(!conn) return Response.json({error:"Connect Shopify first."},{status:409});
  const [digest,signals]=await Promise.all([buildProductsDigest(conn,100),salesSignals(conn)]);
  if("error" in digest) return Response.json({error:digest.error},{status:502});
  const products=(digest.products as DigestProduct[]).map((product):ProductOpportunity=>{
    const sales=signals.byTitle.get(product.title.trim().toLowerCase())??{units:0,revenue:0};
    const abandoned30=signals.abandoned.get(product.title.trim().toLowerCase())??0;
    const completeness=listingScore(product), issues:string[]=[];
    if(product.descChars===0) issues.push("Missing storefront description"); else if(product.descChars<200) issues.push("Thin storefront description");
    if(product.images===0) issues.push("No product images"); else if(product.imagesNoAlt) issues.push(`${product.imagesNoAlt} image${product.imagesNoAlt===1?"":"s"} missing alt text`);
    if(product.tags<3) issues.push("Weak catalog tags");
    if(!product.vendor) issues.push("Missing vendor");
    if(!product.productType) issues.push("Missing product type");
    if(product.soldOut) issues.push("Sold out");
    const oldEnough=Boolean(product.createdAt&&Date.now()-Date.parse(product.createdAt)>=90*86_400_000);
    const archiveEligible=signals.ordersAvailable&&signals.checkoutsAvailable&&oldEnough&&sales.units===0&&abandoned30===0&&product.status==="active";
    const recommendation:ProductOpportunity["recommendation"] = sales.units>=5&&completeness>=70 ? "promote" : completeness<70 ? "improve" : archiveEligible ? "archive_candidate" : "watch";
    const score=Math.min(100,Math.round((100-completeness)*.6+Math.min(abandoned30*8,25)+Math.min(sales.units*2,15)));
    return {id:product.id,title:product.title,status:product.status,score,listingScore:completeness,units90:sales.units,revenue90:Math.round(sales.revenue*100)/100,abandoned30,soldOut:product.soldOut,issues,recommendation,archiveEligible};
  }).sort((a,b)=>b.score-a.score||b.abandoned30-a.abandoned30);
  const listingAverage=products.length?Math.round(products.reduce((n,p)=>n+p.listingScore,0)/products.length):0;
  const collectionData=await shopifyGraphql<{collections?:{nodes?:{id:string;title:string;sortOrder:string;products?:{nodes?:{id:string}[]}}[]}}>(conn.shop_domain,conn.access_token,`query ProductManagerCollections{collections(first:50){nodes{id title sortOrder products(first:100){nodes{id}}}}}`,{});
  const collections=(collectionData?.collections?.nodes??[]).map(row=>({id:row.id,title:row.title,sortOrder:row.sortOrder,products:(row.products?.nodes??[]).map(product=>product.id)}));
  if(env.supabaseUrl&&env.serviceRoleKey){
    const digestBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(products.map(product=>[product.id,product.listingScore,product.units90,product.abandoned30]))));
    const catalogHash=[...new Uint8Array(digestBytes)].map(value=>value.toString(16).padStart(2,"0")).join("");
    const week=new Date();week.setUTCHours(0,0,0,0);week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
    await fetch(`${env.supabaseUrl}/rest/v1/product_manager_snapshots?on_conflict=user_id,shop_domain,week_start`,{method:"POST",headers:{apikey:env.serviceRoleKey,Authorization:`Bearer ${env.serviceRoleKey}`,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:user.id,shop_domain:conn.shop_domain,week_start:week.toISOString().slice(0,10),catalog_hash:catalogHash,summary:{listingAverage,needsWork:products.filter(product=>product.recommendation==="improve").length},opportunities:products.slice(0,30)})}).catch(()=>null);
  }
  const savedResearch=await latestResearch(env,user.id,conn.shop_domain);
  const latestResearchReport=savedResearch&&reportFitsCatalog(savedResearch as HuntReport,{host:conn.shop_domain,storeTitle:conn.shop_domain,storeDescription:"Connected Shopify catalog",priceBand:null,productTitles:(digest.products as DigestProduct[]).map(product=>product.title)})?savedResearch:null;
  return Response.json({shop:conn.shop_domain,scanned:products.length,listingAverage,needsWork:products.filter(p=>p.recommendation==="improve").length,promote:products.filter(p=>p.recommendation==="promote").length,archiveCandidates:products.filter(p=>p.recommendation==="archive_candidate").length,signals:{orders:signals.ordersAvailable,abandonedCheckouts:signals.checkoutsAvailable,pageViews:false},products,collections,latestResearch:latestResearchReport,generatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
}

type ProductDetail={id:string;title:string;descriptionHtml?:string|null;vendor?:string|null;productType?:string|null;tags?:string[];category?:{name?:string|null;fullName?:string|null};media?:{nodes?:{id?:string;alt?:string|null}[]};options?:{name?:string;values?:string[]}[];variants?:{nodes?:{title?:string;selectedOptions?:{name?:string;value?:string}[]}[]};metafields?:{nodes?:{namespace?:string;key?:string;type?:string;value?:string;jsonValue?:unknown;definition?:{name?:string|null};reference?:{name?:string;displayName?:string};references?:{nodes?:{name?:string;displayName?:string}[]}}[]}};

const NON_COMMERCE_QUERY=/\b(download|game|repo|github|code|software|wallpaper|video|meaning|definition|tweak|pakistan|india)\b/i;
const ACCESSORY_QUERY=/\b(bag|case|cover|rack|boots?|bindings?|stickers?|wax|cleaner|kit)\b/i;
function merchantFacts(raw:unknown):Record<string,string>{
  if(!raw||typeof raw!=="object")return {};
  return Object.fromEntries(Object.entries(raw as Record<string,unknown>).map(([key,value])=>[clean(key,80),clean(value,2_000)]).filter(([key,value])=>key&&value));
}
function listingFactsReady(product:ProductDetail,confirmed:Record<string,string>):boolean{
  const description=strip(product.descriptionHtml??"");
  const attributes=extractCatalogFacts(product as Parameters<typeof extractCatalogFacts>[0]);
  const meaningfulOptions=(product.options??[]).filter(option=>option.name&&option.name.toLowerCase()!=="title"&&(option.values??[]).some(value=>value&&value.toLowerCase()!=="default title"));
  return description.length>=80||attributes.length>=2||meaningfulOptions.length>=1||Object.values(confirmed).join(" ").length>=60;
}

async function generateListing(env:ShopifyEnv,product:ProductDetail,market:string,confirmed:Record<string,string>={}){
  const facts={title:product.title,description:strip(product.descriptionHtml??""),vendor:product.vendor??"",productType:product.productType??"",tags:product.tags??[],options:product.options??[],merchantConfirmedFacts:confirmed};
  if(!facts.description&& !facts.vendor && !facts.productType && facts.tags.length===0) return null;
  const seed=clean(product.productType||product.category?.name||product.title,120).toLowerCase();
  const research=await collectEvidence(seed,market,"en");
  const factualLanguage=[product.title,product.productType,product.category?.name,Object.values(confirmed).join(" ")].filter(Boolean).join(" ");
  const keywords=buildKeywordCandidates(seed,research.suggestions,research.marketplaces,[...(product.tags??[]),product.category?.name??"",product.productType??""]).filter(row=>!NON_COMMERCE_QUERY.test(row.keyword)&&(!ACCESSORY_QUERY.test(row.keyword)||ACCESSORY_QUERY.test(seed))&&!(row.keyword.includes("beginner")&&/\bintermediate\b/i.test(factualLanguage)));
  const primary=keywords.find(row=>row.sources.some(source=>source==="amazon"||source==="ebay"))??keywords[0];
  if(!primary)return null;
  const secondary=keywords.filter(row=>row.keyword!==primary.keyword).slice(0,5);
  const commerceEvidence=primary.sources.some(source=>source==="amazon"||source==="ebay");
  const attributes=extractCatalogFacts(product as Parameters<typeof extractCatalogFacts>[0]);
  const missingFacts=[!product.vendor?"Brand/vendor":"",!product.productType&&!product.category?.name?"Product type/category":"",!(product.options??[]).length?"Variant or option details":"",!(product.media?.nodes??[]).length?"Product images":"",facts.description.length<80?"Verified features and specifications":""].filter(Boolean);
  try{
    const response=await fetch(`${GROQ_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${env.groqKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"llama-3.3-70b-versatile",temperature:.15,max_tokens:1400,response_format:{type:"json_object"},messages:[{role:"system",content:"Return JSON only. You are a senior Amazon/eBay product-listing copywriter preparing a shopper-visible Shopify listing. Treat merchantConfirmedFacts as verified source material that must be professionally developed, not copied as rough notes. Never invent materials, dimensions, compatibility, performance guarantees, certifications, reviews, audiences, or use cases. Keep the storefront title under 70 characters, natural, and meaningfully specific: retain a useful existing product name or add a verified differentiator such as material or intended rider; never reduce it to only the generic product type. Write 180-320 words of clean descriptionHtml: an informative opening paragraph, a descriptive <h3> heading, 4-6 factual <li> benefit/detail bullets, a <h3>What's included</h3> section when package contents are known, and a concise care/use paragraph when confirmed. Explain confirmed features clearly without hype, repetition, keyword stuffing, or awkward phrases such as 'is a product type'. Preserve every useful existing tag and add only supported tags. Return {title,descriptionHtml,tags,rationale}."},{role:"user",content:JSON.stringify({facts,listingResearch:{primary:primary.keyword,secondary:secondary.map(row=>row.keyword),marketplaceSources:research.status}})}]}),signal:AbortSignal.timeout(25_000)});
    if(!response.ok)return null;
    const data=await response.json() as {choices?:{message?:{content?:string}}[]};
    const parsed=JSON.parse(data.choices?.[0]?.message?.content??"{}") as Record<string,unknown>;
    const title=clean(parsed.title,70), descriptionHtml=typeof parsed.descriptionHtml==="string"?parsed.descriptionHtml.slice(0,20_000):"";
    const suggestedTags=Array.isArray(parsed.tags)?parsed.tags.map(v=>clean(v,80)).filter(Boolean):[];
    const tags=[...new Set([...(product.tags??[]).map(tag=>clean(tag,80)).filter(Boolean),...suggestedTags])].slice(0,20);
    const descriptionWords=strip(descriptionHtml).split(/\s+/).filter(Boolean).length;
    if(!title||descriptionWords<120||!/<(?:ul|ol)\b/i.test(descriptionHtml)||!/what(?:'|’)?s included/i.test(descriptionHtml)&&Object.values(confirmed).join(" ").toLowerCase().includes("include"))return null;
    const marketplace=research.status.filter(row=>row.status==="available").map(row=>({source:row.source,observation:`Reviewed ${row.observations} current public results for listing language and shopper intent.`,metric:`${row.observations} observations`,sourceUrl:row.url}));
    return {title,descriptionHtml,tags,rationale:clean(parsed.rationale,800),keywords:keywords.slice(0,6).map(row=>({keyword:row.keyword,evidence:`Listing relevance score ${row.score}/100 from ${row.sources.join(", ")}.`,sourceUrl:row.sources.includes("amazon")?sourceUrl("amazon",seed,market):row.sources.includes("ebay")?sourceUrl("ebay",seed,market):research.status[0]?.url??sourceUrl("google",seed,market)})),marketplace,listingVa:{audit:[...(!facts.description?["Missing storefront description"]:facts.description.length<200?["Storefront description is thin"]:[]),...(!product.vendor?["Missing brand/vendor"]:[]),...(!product.productType?["Missing product type"]:[]),...((product.tags??[]).length<3?["Weak catalog tags"]:[]),...(!(product.media?.nodes??[]).length?["No product images"]:(product.media?.nodes??[]).some(image=>!image.alt)?["Some images need alt text"]:[])],shopperIntent:commerceEvidence?`Current Amazon/eBay listing evidence most strongly supports “${primary.keyword}”; supporting commerce phrases include ${secondary.filter(row=>row.sources.some(source=>source==="amazon"||source==="ebay")).map(row=>`“${row.keyword}”`).join(", ")||"none with enough evidence"}.`:`Live Amazon/eBay results were unavailable. The draft uses “${primary.keyword}” only as category language and relies on the merchant-confirmed product facts for every claim.`,titleStrategy:"Use a clear storefront title that identifies the product first, then only verified differentiators. This is the shopper-visible product title, not the SEO title.",descriptionStrategy:"Lead with what the product is, then organize verified features, variants, and purchase-relevant facts into scannable paragraphs and bullets.",tagStrategy:"Preserve useful catalog tags and add only research-backed phrases supported by the actual product facts.",imagePlan:(product.media?.nodes??[]).length?["Keep existing product media","Fill missing alt text only with verified visible/product facts"]:["Add merchant-owned primary, detail, scale, and use-context images before publishing"],missingFacts,preserved:["SEO title unchanged","Meta description unchanged","Price and inventory unchanged",...attributes.slice(0,4).map(row=>`${row.label}: ${row.value}`)]}};
  }catch{return null;}
}

export async function productManagerOptimize(body:{productId?:unknown;confirmedFacts?:unknown},authHeader:string|null,env:ShopifyEnv):Promise<Response>{
  const user=await resolveUserFull(env,authHeader);
  if(!user)return Response.json({error:"Sign in first."},{status:401});
  if(!(await hasRole(env,user.id,"product",user.email))){const denied=roleRequired("product");return Response.json(denied.body,{status:denied.status});}
  const conn=await getConnection(env,user.id), productId=validId(body.productId);
  if(!conn)return Response.json({error:"Connect Shopify first."},{status:409});
  if(!productId)return Response.json({error:"Choose a valid product."},{status:400});
  const data=await shopifyGraphql<{shop?:{billingAddress?:{countryCodeV2?:string|null}};product?:ProductDetail}>(conn.shop_domain,conn.access_token,`query ProductManagerListing($id:ID!){shop{billingAddress{countryCodeV2}} product(id:$id){id title descriptionHtml vendor productType tags category{name fullName} options{name values} variants(first:50){nodes{title selectedOptions{name value}}} metafields(first:50){nodes{namespace key type value jsonValue definition{name} reference{... on TaxonomyValue{name} ... on Metaobject{displayName}} references(first:20){nodes{... on TaxonomyValue{name} ... on Metaobject{displayName}}}}} media(first:50){nodes{id alt}}}}`,{id:productId});
  const product=data?.product;
  if(!product)return Response.json({error:"Could not load that product from Shopify."},{status:502});
  const confirmed=merchantFacts(body.confirmedFacts);
  if(!listingFactsReady(product,confirmed))return Response.json({error:"I won’t generate filler copy for this product. Add at least one verified specification set, meaningful product options, or an 80+ character factual description in Shopify, then retry. Product type, vendor, and generic tags alone are not enough for a professional listing."},{status:422});
  const market=clean(data?.shop?.billingAddress?.countryCodeV2,8).toLowerCase()||"us";
  const listing=await generateListing(env,product,market,confirmed);
  if(!listing)return Response.json({error:"The professional listing writer could not complete a structured draft from the verified facts. Nothing was changed; retry the draft."},{status:502});
  const mediaAlt=(product.media?.nodes??[]).filter(media=>media.id&&!clean(media.alt,200)).map(media=>({id:media.id!,alt:product.title}));
  const proposal=await runActionPropose({kind:"product_update",summary:`Product Listing VA update for ${product.title}`,items:[{productId,title:listing.title,descriptionHtml:listing.descriptionHtml,tags:listing.tags,...(mediaAlt.length?{mediaAlt}:{})}],evidence:{rationale:listing.rationale,keywords:listing.keywords,marketplace:listing.marketplace,listingVa:listing.listingVa,limitations:`Marketplace signals guide wording and shopper intent; every product claim still comes from verified Shopify facts. SEO title and meta description are unchanged.${mediaAlt.length?" Missing image alt text uses the verified product title without inventing visual details.":""}`},optimizerVersion:"product-listing-va-v1"},authHeader,env);
  const payload=await proposal.json().catch(()=>({})) as {action?:ShopifyActionRow;error?:string};
  return Response.json(payload.action?{action:payload.action}:{error:payload.error??"Could not save the proposal."},{status:proposal.status});
}

export async function productManagerArchive(body:{productId?:unknown;title?:unknown},authHeader:string|null,env:ShopifyEnv):Promise<Response>{
  const productId=validId(body.productId), title=clean(body.title,255)||"product";
  if(!productId)return Response.json({error:"Choose a valid product."},{status:400});
  const user=await resolveUserFull(env,authHeader);
  if(!user)return Response.json({error:"Sign in first."},{status:401});
  if(!(await hasRole(env,user.id,"product",user.email))){const denied=roleRequired("product");return Response.json(denied.body,{status:denied.status});}
  const conn=await getConnection(env,user.id);
  if(!conn)return Response.json({error:"Connect Shopify first."},{status:409});
  const [digest,signals]=await Promise.all([buildProductsDigest(conn,100),salesSignals(conn)]);
  if("error" in digest)return Response.json({error:digest.error},{status:502});
  const product=(digest.products as DigestProduct[]).find(item=>item.id===productId);
  if(!product)return Response.json({error:"That product is outside the current catalog scan. Refresh Product Manager and try again."},{status:409});
  const sales=signals.byTitle.get(product.title.trim().toLowerCase())??{units:0,revenue:0};
  const abandoned=signals.abandoned.get(product.title.trim().toLowerCase())??0;
  const oldEnough=Boolean(product.createdAt&&Date.now()-Date.parse(product.createdAt)>=90*86_400_000);
  if(!signals.ordersAvailable||!signals.checkoutsAvailable||!oldEnough||product.status!=="active"||sales.units>0||abandoned>0){
    return Response.json({error:"This product no longer meets the archive safety rule: active for 90+ days, zero units sold in 90 days, zero abandoned-checkout appearances in 30 days, with both data sources available."},{status:409});
  }
  return runActionPropose({kind:"product_status_update",summary:`Archive ${title}`,items:[{productId,status:"ARCHIVED"}],evidence:{rationale:"No recorded sales or abandoned-checkout activity was found in the analyzed windows. Review inventory and traffic outside Shopify before approval.",limitations:"Shopify does not provide product page-view data here, so this is not proof that shoppers rejected the product."}},authHeader,env);
}
