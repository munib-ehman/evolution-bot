import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, shopifyGraphql, type ShopifyEnv } from "./_shopify";
import { GROQ_BASE } from "./_shared";
import { runActionPropose, type ShopifyActionRow } from "./_actions";

export interface SeoOptimizeBody {
  productId?: unknown;
  market?: unknown;
  language?: unknown;
  confirmedFacts?: unknown;
}

export interface SeoKeywordCandidate {
  keyword: string;
  score: number;
  relevance: number;
  marketplace: number;
  intent: number;
  sources: string[];
}

export interface SeoSourceStatus {
  source: "google_suggest" | "amazon" | "ebay";
  status: "available" | "unavailable";
  url: string;
  observations: number;
  detail?: string;
}

type ProductDetail = {
  id: string;
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  seo?: { title?: string | null; description?: string | null } | null;
  category?: { name?: string | null; fullName?: string | null } | null;
  options?: { name?: string; values?: string[] }[];
  media?: { nodes?: { id?: string; alt?: string | null }[] };
  variants?: { nodes?: { title?: string; selectedOptions?: { name?: string; value?: string }[] }[] };
  metafields?: { nodes?: ProductMetafield[] };
};
type ProductMetafield = { namespace?:string;key?:string;type?:string;value?:string;jsonValue?:unknown;definition?:{name?:string|null}|null;reference?:{__typename?:string;name?:string;displayName?:string}|null;references?:{nodes?:{__typename?:string;name?:string;displayName?:string}[]}|null };
type ShopLocale = { currencyCode?: string | null; billingAddress?: { countryCodeV2?: string | null } | null };

const SEO_MODEL = "llama-3.1-8b-instant";
const STOP = new Set(["the", "a", "an", "and", "or", "for", "with", "by", "from", "of", "to", "in", "on", "at", "product"]);
const INTENT = new Set(["buy", "shop", "best", "online", "sale", "premium", "affordable", "mens", "womens", "kids", "beginner", "professional"]);
const CLAIM_WORDS = ["durable", "high-quality", "high quality", "waterproof", "lightweight", "eco-friendly", "eco friendly", "premium", "perfect", "ideal", "advanced", "certified", "organic", "handmade", "compatible"];
const PUBLIC_CACHE_MS = 24 * 60 * 60 * 1_000;
const publicCache = new Map<string,{at:number;text:string|null}>();
const clean = (value: unknown, max = 300) => (typeof value === "string" ? value : "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const tokens = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(token => token.length > 1 && !STOP.has(token));
const phrase = (value: string) => tokens(value).slice(0, 6).join(" ");
const validProductId = (value: unknown) => typeof value === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(value) ? value : null;

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function extractMarketplaceTitles(html: string, source: "amazon" | "ebay"): string[] {
  const patterns = source === "amazon"
    ? [/<h2[^>]*>\s*<[^>]+>\s*<span[^>]*>([\s\S]*?)<\/span>/gi, /class="a-size-base-plus[^\"]*"[^>]*>([\s\S]*?)<\//gi]
    : [/<div[^>]+class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, /<span[^>]+role="heading"[^>]*>([\s\S]*?)<\/span>/gi];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const title = clean(stripHtml(decodeHtml(match[1] ?? "")), 240);
      if (title && !/^shop on ebay/i.test(title) && !found.includes(title)) found.push(title);
      if (found.length >= 30) return found;
    }
  }
  return found;
}

export function buildKeywordCandidates(seedRaw: string, suggestions: string[], marketplaces: { source: string; titles: string[] }[], catalogTerms:string[]=[]): SeoKeywordCandidate[] {
  const seed = phrase(seedRaw);
  const seedTokens = new Set(tokens(seed));
  const contextTokens = new Set(catalogTerms.flatMap(value=>tokens(value)));
  const rows = new Map<string, { sources:Set<string>; occurrences:number }>();
  const add = (raw: string, source: string) => {
    const value = phrase(raw);
    const words = tokens(value);
    if (!value || words.length < 1 || words.length > 6 || !words.some(word => seedTokens.has(word)||contextTokens.has(word))) return;
    const row = rows.get(value) ?? { sources:new Set<string>(), occurrences:0 };
    row.sources.add(source); row.occurrences += 1; rows.set(value, row);
  };
  add(seed, "shopify");
  catalogTerms.forEach(value=>add(value,"shopify"));
  suggestions.forEach(value => add(value, "google_suggest"));
  marketplaces.forEach(group => group.titles.forEach(title => {
    const words = tokens(title);
    add(words.slice(0, 5).join(" "), group.source);
    for (let size = 2; size <= Math.min(4, words.length); size++) for (let i = 0; i <= words.length - size; i++) add(words.slice(i, i + size).join(" "), group.source);
  }));
  return [...rows.entries()].map(([keyword, row]) => {
    const words = tokens(keyword);
    const overlap = words.filter(word => seedTokens.has(word)).length / Math.max(seedTokens.size, 1);
    const contextOverlap = words.filter(word=>contextTokens.has(word)).length / Math.max(Math.min(contextTokens.size,6),1);
    const relevance = Math.round(Math.min(100, overlap * 65 + contextOverlap * 20 + (keyword === seed ? 15 : 0)));
    const marketSources = [...row.sources].filter(source => source === "amazon" || source === "ebay" || source === "google_suggest");
    const marketplace = Math.round(Math.min(100, marketSources.length * 30 + Math.min(row.occurrences, 10) * 4));
    const intent = words.some(word => INTENT.has(word)) ? 100 : words.length >= 2 ? 60 : 30;
    return { keyword, relevance, marketplace, intent, score: Math.round(relevance * .55 + marketplace * .35 + intent * .1), sources:[...row.sources] };
  }).filter(row => row.relevance >= 35).sort((a,b) => b.score - a.score || a.keyword.localeCompare(b.keyword)).slice(0, 20);
}

export function containsUnsupportedClaims(copy: string, factualText: string): boolean {
  const normalizedCopy = copy.toLowerCase();
  const normalizedFacts = factualText.toLowerCase();
  return CLAIM_WORDS.some(claim => normalizedCopy.includes(claim) && !normalizedFacts.includes(claim));
}

export function sourceUrl(source: string, query: string, market: string): string {
  const amazonDomain: Record<string,string> = {us:"amazon.com",gb:"amazon.co.uk",ca:"amazon.ca",au:"amazon.com.au",de:"amazon.de",fr:"amazon.fr",it:"amazon.it",es:"amazon.es",in:"amazon.in",jp:"amazon.co.jp"};
  const ebayDomain: Record<string,string> = {us:"ebay.com",gb:"ebay.co.uk",ca:"ebay.ca",au:"ebay.com.au",de:"ebay.de",fr:"ebay.fr",it:"ebay.it",es:"ebay.es"};
  if (source === "amazon") return `https://www.${amazonDomain[market]??amazonDomain.us}/s?k=${encodeURIComponent(query)}`;
  if (source === "ebay") return `https://www.${ebayDomain[market]??ebayDomain.us}/sch/i.html?_nkw=${encodeURIComponent(query)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${encodeURIComponent(market)}`;
}

async function fetchText(url: string): Promise<string | null> {
  const cached = publicCache.get(url);
  if (cached && Date.now()-cached.at<PUBLIC_CACHE_MS) return cached.text;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EvolutionSEO/1.0; +https://www.runevolution.io)" }, signal: AbortSignal.timeout(12_000) });
    const text = response.ok ? (await response.text()).slice(0, 1_500_000) : null;
    publicCache.set(url,{at:Date.now(),text});
    return text;
  } catch { publicCache.set(url,{at:Date.now(),text:null}); return null; }
}

export async function collectEvidence(seed: string, market: string, language: string) {
  const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(language)}&q=${encodeURIComponent(seed)}`;
  const amazonUrl = sourceUrl("amazon", seed, market);
  const ebayUrl = sourceUrl("ebay", seed, market);
  const [suggestRaw, amazonHtml, ebayHtml] = await Promise.all([fetchText(suggestUrl), fetchText(amazonUrl), fetchText(ebayUrl)]);
  let suggestions: string[] = [];
  try { suggestions = (JSON.parse(suggestRaw ?? "[]") as unknown[])[1] as string[] ?? []; } catch { /* unavailable */ }
  const amazon = amazonHtml ? extractMarketplaceTitles(amazonHtml, "amazon") : [];
  const ebay = ebayHtml ? extractMarketplaceTitles(ebayHtml, "ebay") : [];
  const status: SeoSourceStatus[] = [
    { source:"google_suggest", status:suggestions.length?"available":"unavailable", url:suggestUrl, observations:suggestions.length, detail:suggestions.length?undefined:"No suggestions returned." },
    { source:"amazon", status:amazon.length?"available":"unavailable", url:amazonUrl, observations:amazon.length, detail:amazon.length?undefined:"Amazon results were not available for this research." },
    { source:"ebay", status:ebay.length?"available":"unavailable", url:ebayUrl, observations:ebay.length, detail:ebay.length?undefined:"eBay results were not available for this research." },
  ];
  return { suggestions, marketplaces:[{source:"amazon",titles:amazon},{source:"ebay",titles:ebay}], status };
}

function confirmedFacts(raw: unknown): Record<string,string> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string,unknown>).map(([key,value]) => [clean(key,80), clean(value,500)]).filter(([key,value]) => key && value));
}

export function extractCatalogFacts(product:ProductDetail):{label:string;value:string;source:"category"|"product"}[] {
  const rows:{label:string;value:string;source:"category"|"product"}[]=[];
  for(const metafield of product.metafields?.nodes??[]){
    if(metafield.namespace!=="shopify"&&metafield.namespace!=="custom") continue;
    const referenced=[metafield.reference,...(metafield.references?.nodes??[])].filter(Boolean).map(reference=>clean(reference?.name||reference?.displayName,200)).filter(Boolean);
    let value=referenced.join(", ");
    if(!value){
      if(typeof metafield.jsonValue==="string") value=clean(metafield.jsonValue,500);
      else if(typeof metafield.jsonValue==="number"||typeof metafield.jsonValue==="boolean") value=String(metafield.jsonValue);
      else if(Array.isArray(metafield.jsonValue)&&metafield.jsonValue.every(entry=>["string","number","boolean"].includes(typeof entry))) value=clean(metafield.jsonValue.join(", "),500);
      else if(metafield.type&&!/(?:reference|file)/.test(metafield.type)) value=clean(metafield.value,500);
    }
    const label=clean(metafield.definition?.name||metafield.key?.replace(/[_-]+/g," "),120);
    if(label&&value) rows.push({label,value,source:metafield.namespace==="shopify"?"category":"product"});
  }
  return rows.slice(0,30);
}

async function renderListing(env: ShopifyEnv, product: ProductDetail, primary: string, secondary: string[], facts: Record<string,string>, research: Awaited<ReturnType<typeof collectEvidence>>) {
  const factualDescription = stripHtml(product.descriptionHtml ?? "");
  const catalogFacts=extractCatalogFacts(product);
  const factualText = [product.title,product.vendor,product.productType,product.category?.name,product.category?.fullName,(product.tags??[]).join(" "),factualDescription,...catalogFacts.flatMap(fact=>[fact.label,fact.value]),...Object.values(facts)].filter(Boolean).join(" ");
  const structuredFacts = [product.vendor,product.productType,product.category?.name,(product.tags??[]).length?product.tags!.join(", "):"",...catalogFacts.map(fact=>`${fact.label}: ${fact.value}`),...(product.options??[]).filter(option=>(option.values??[]).length).map(option=>`${option.name}: ${option.values!.join(", ")}`),...Object.values(facts)].filter(Boolean);
  const enoughForDescription = Boolean(factualDescription.length >= 80 || structuredFacts.length >= 2);
  const response = await fetch(`${GROQ_BASE}/chat/completions`, {
    method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.groqKey}`},
    body:JSON.stringify({ model:SEO_MODEL, temperature:0.1, max_tokens:900, response_format:{type:"json_object"}, messages:[
      {role:"system",content:"Return JSON only. You are a senior ecommerce SEO and generative-engine optimization merchandiser reviewing evidence already collected by tools. First evaluate the original Shopify listing and supplied search evidence; then produce the strongest factually supportable listing. Never invent materials, durability, benefits, compatibility, specifications, certifications, reviews, audiences, or product uses. GEO means making useful product facts clear, unambiguous, and easy for search and answer systems to extract; never promise rankings, citations, or AI inclusion. Explain keyword use without stuffing. SEO title <=60 characters. Meta description <=160 characters. Tags must be useful catalog/search phrases supported by evidence. When allowDescription is true, descriptionHtml must lead with a concise plain-language product explanation and organize only confirmed details under descriptive headings; do not add invented FAQs or filler. descriptionHtml must be null when allowDescription is false. Every analysis field must be concise, specific, and understandable to a merchant."},
      {role:"user",content:JSON.stringify({originalListing:{title:product.title,seoTitle:product.seo?.title,seoDescription:product.seo?.description,vendor:product.vendor,productType:product.productType,category:product.category,categoryMetafields:catalogFacts.filter(fact=>fact.source==="category"),productMetafields:catalogFacts.filter(fact=>fact.source==="product"),tags:product.tags,currentDescription:factualDescription,options:product.options,variants:product.variants?.nodes?.slice(0,10),images:{total:product.media?.nodes?.length??0,missingAlt:product.media?.nodes?.filter(image=>!image.alt)?.length??0}},confirmedFacts:facts,research:{primaryKeyword:primary,secondaryKeywords:secondary,googleSuggestions:research.suggestions.slice(0,12),marketplaceTitles:research.marketplaces.map(group=>({source:group.source,titles:group.titles.slice(0,8)})),sourceStatus:research.status},allowDescription:enoughForDescription,shape:{seoTitle:"string",seoDescription:"string",descriptionHtml:"string|null",tags:["string"],review:{currentListing:"what is weak or missing in the original listing",shopperIntent:"what the evidence suggests shoppers want",keywordUse:"where and how to use the selected keywords",titleAdvice:"why the proposed title is stronger",descriptionAdvice:"how the proposed meta/product description helps",tagAdvice:"why these tags are useful"}}})},
    ]}), signal:AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(()=>({})) as {choices?:{message?:{content?:string}}[]};
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Record<string,unknown>;
    const seoTitle = clean(parsed.seoTitle,60), seoDescription = clean(parsed.seoDescription,160);
    const descriptionHtml = enoughForDescription ? clean(parsed.descriptionHtml,10_000) : "";
    const allowedTagTokens = new Set(tokens(`${factualText} ${primary} ${secondary.join(" ")}`));
    const tags = Array.isArray(parsed.tags) ? [...new Set(parsed.tags.map(value=>clean(value,80)).filter(value=>value&&tokens(value).every(token=>allowedTagTokens.has(token))))].slice(0,12) : [];
    const reviewRaw = parsed.review && typeof parsed.review === "object" ? parsed.review as Record<string,unknown> : {};
    const review = {currentListing:clean(reviewRaw.currentListing,1000),shopperIntent:clean(reviewRaw.shopperIntent,1000),keywordUse:clean(reviewRaw.keywordUse,1000),titleAdvice:clean(reviewRaw.titleAdvice,1000),descriptionAdvice:clean(reviewRaw.descriptionAdvice,1000),tagAdvice:clean(reviewRaw.tagAdvice,1000)};
    const combined = `${seoTitle} ${seoDescription} ${descriptionHtml}`;
    const reviewedText = `${combined} ${Object.values(review).join(" ")}`;
    const primaryCount = combined.toLowerCase().split(primary.toLowerCase()).length - 1;
    if (!seoTitle || !seoDescription || !seoTitle.toLowerCase().includes(primary.split(" ")[0]) || !seoDescription.toLowerCase().includes(primary.split(" ")[0]) || primaryCount > 3 || containsUnsupportedClaims(reviewedText,factualText)) return null;
    return {seoTitle,seoDescription,descriptionHtml,tags,enoughForDescription,review};
  } catch { return null; }
}

function safeListingFallback(product: ProductDetail, primary: string, secondary: string[], facts: Record<string,string>) {
  const factualDescription = stripHtml(product.descriptionHtml ?? "");
  const catalogFacts=extractCatalogFacts(product);
  const structuredFacts = [product.vendor,product.productType,product.category?.name,(product.tags??[]).length?product.tags!.join(", "):"",...catalogFacts.map(fact=>`${fact.label}: ${fact.value}`),...(product.options??[]).filter(option=>(option.values??[]).length).map(option=>`${option.name}: ${option.values!.join(", ")}`),...Object.values(facts)].filter(Boolean);
  const enoughForDescription = Boolean(factualDescription.length >= 80 || structuredFacts.length >= 2);
  const titleAlreadyMatches = product.title.toLowerCase().includes(primary.toLowerCase());
  const seoTitle = clean(titleAlreadyMatches ? product.title : `${primary} | ${product.title}`, 60);
  const vendor = clean(product.vendor, 80);
  const seoDescription = clean(
    titleAlreadyMatches
      ? `Explore ${product.title}${vendor ? ` by ${vendor}` : ""}. View product details and available options.`
      : `Explore ${product.title}${vendor ? ` by ${vendor}` : ""}. Find details and available options for this ${primary}.`,
    160,
  );
  const tags = [...new Set([primary, ...secondary].map(value => clean(value, 80)).filter(Boolean))].slice(0, 8);
  const optionSummary = (product.options??[]).filter(option=>(option.values??[]).length).map(option=>`${option.name}: ${option.values!.join(", ")}`).join("; ");
  const knownType = clean(product.productType||product.category?.name||facts.productType,120);
  const knownBrand = clean(product.vendor||facts.brand,120);
  const descriptionHtml = enoughForDescription ? `<p>${product.title}${knownBrand?` by ${knownBrand}`:""}${knownType?` is listed as ${knownType}`:""}. This product page is the authoritative source for its current price, availability, images, and purchasing options.</p><p>${optionSummary?`Available configurations shown by Shopify include ${optionSummary}. `:""}Review the displayed product media, variant selections, price, availability, and confirmed listing details before ordering.</p>` : "";
  const missing = [!product.seo?.title?"search title":"",!product.seo?.description?"meta description":"",!factualDescription?"product description":"",!(product.tags??[]).length?"descriptive tags":""].filter(Boolean);
  const review = {
    currentListing: missing.length ? `The current listing is missing ${missing.join(", ")}.` : "The current listing can be aligned more closely with the strongest researched search phrase.",
    shopperIntent: `The available search and marketplace results most strongly match “${primary}”.`,
    keywordUse: `Use “${primary}” once in the search title and meta description. Use ${secondary.length ? secondary.map(value=>`“${value}”`).join(", ") : "related phrases"} only where they read naturally.`,
    titleAdvice: "The proposed search title leads with the clearest relevant phrase while retaining the original product name.",
    descriptionAdvice: enoughForDescription ? "The description should explain the verified product details in shopper-friendly language." : "The meta description stays factual; a full product description needs more confirmed product details.",
    tagAdvice: "The proposed tags come from the researched phrases and can support Shopify organization and onsite search.",
  };
  return { seoTitle, seoDescription, descriptionHtml, tags, enoughForDescription, review };
}

export async function runSeoOptimize(body: SeoOptimizeBody, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return Response.json({error:"Sign in first."},{status:401});
  if (!(await isOperator(env,user.id,user.email))) return Response.json(OPERATOR_REQUIRED.body,{status:OPERATOR_REQUIRED.status});
  const conn = await getConnection(env,user.id);
  if (!conn) return Response.json({error:"Connect Shopify first."},{status:409});
  const productId = validProductId(body.productId);
  if (!productId) return Response.json({error:"Choose a valid Shopify product."},{status:400});
  const result = await shopifyGraphql<{product?:ProductDetail;shop?:ShopLocale}>(conn.shop_domain,conn.access_token,`query SeoOptimizerProduct($id: ID!) { shop { currencyCode billingAddress { countryCodeV2 } } product(id:$id) { id title descriptionHtml vendor productType tags seo { title description } category { id name fullName } metafields(first:50) { nodes { namespace key type value jsonValue definition { name } reference { __typename ... on TaxonomyValue { name } ... on Metaobject { displayName } } references(first:20) { nodes { __typename ... on TaxonomyValue { name } ... on Metaobject { displayName } } } } } options { name values } media(first:50) { nodes { id alt } } variants(first:50) { nodes { title selectedOptions { name value } } } } }`,{id:productId});
  const product = result?.product;
  if (!product) return Response.json({error:"Could not load that product from Shopify."},{status:502});
  const facts = confirmedFacts(body.confirmedFacts);
  const market = clean(body.market,8).toLowerCase() || clean(result?.shop?.billingAddress?.countryCodeV2,8).toLowerCase() || "us";
  const language = clean(body.language,8).toLowerCase() || "en";
  const seed = phrase(product.productType || product.category?.name || product.title);
  if (!seed) return Response.json({error:"This product needs a category or descriptive title before keyword research."},{status:422});
  const evidence = await collectEvidence(seed,market,language);
  const catalogTerms = [...(product.tags??[]),product.category?.name??"",product.productType??""].filter(Boolean);
  const keywords = buildKeywordCandidates(seed,evidence.suggestions,evidence.marketplaces,catalogTerms);
  const primary = keywords[0];
  if (!primary || !primary.sources.some(source=>source!=="shopify")) return Response.json({error:"I couldn’t find enough current search or marketplace evidence for this product, so I didn’t prepare an update. Please try again shortly.",sources:evidence.status},{status:422});
  const secondary = keywords.slice(1,5).map(row=>row.keyword);
  const rendered = await renderListing(env,product,primary.keyword,secondary,facts,evidence)
    ?? safeListingFallback(product,primary.keyword,secondary,facts);
  const marketplaceEvidence = evidence.status.filter(row=>row.status==="available").map(row=>({source:row.source,observation:`${row.observations} current public result${row.observations===1?"":"s"} contributed to keyword scoring.`,metric:`${row.observations} observations`,sourceUrl:row.url}));
  const catalogContext = {category:clean(product.category?.fullName||product.category?.name,240),existingTags:(product.tags??[]).map(tag=>clean(tag,80)).filter(Boolean).slice(0,30),attributes:extractCatalogFacts(product)};
  const items: Record<string,unknown>[] = [{productId,seoTitle:rendered.seoTitle,seoDescription:rendered.seoDescription}];
  const geoPlan = { label:"AI/GEO analysis", improves:["Search title clarity","Meta-description intent alignment"], safeguards:["Storefront title, description, tags, taxonomy, and image alt text remain unchanged","No unsupported product claims","No promise of AI citations or rankings"], manualGaps:[...(!product.vendor?["Ask Product Manager to confirm the product brand/vendor"]:[]),...((product.media?.nodes??[]).some(image=>!image.alt)?["Ask Product Manager to review missing image alt text"]:[]),...(!rendered.descriptionHtml?["Ask Product Manager to collect facts for a richer storefront description"]:[])] };
  const proposal = await runActionPropose({kind:"product_update",summary:`SEO + AI/GEO update for ${product.title}`,items,evidence:{keywords:keywords.slice(0,5).map(row=>({keyword:row.keyword,evidence:`Score ${row.score}/100 from ${row.sources.join(", ")}.`,sourceUrl:row.sources.includes("amazon")?sourceUrl("amazon",seed,market):row.sources.includes("ebay")?sourceUrl("ebay",seed,market):evidence.status[0].url})),marketplace:marketplaceEvidence,catalogContext,rationale:`Selected “${primary.keyword}” using the Shopify category, confirmed catalog attributes, and the strongest available search and marketplace evidence.`,review:rendered.review,geo:geoPlan,limitations:`The connected sources do not provide dependable monthly search volume, and no optimizer can guarantee inclusion in AI answers. ${rendered.enoughForDescription?"The description uses confirmed product details.":"The storefront description was left unchanged because the product needs more confirmed details."}`},optimizerVersion:"seo-geo-tools-v4",targetMarket:{market,language},keywordPlan:{primary:primary.keyword,secondary,candidates:keywords},sourceStatus:evidence.status,confirmedFacts:facts,geoPlan},authHeader,env);
  const payload = await proposal.json().catch(()=>({})) as {action?:ShopifyActionRow;error?:string};
  return Response.json(payload.action?{action:payload.action,keywords,sources:evidence.status,missingFacts:rendered.enoughForDescription?[]:["material or construction","intended use or rider level","two verified product features"]}:{error:payload.error??"Could not save the SEO proposal."},{status:proposal.status});
}
