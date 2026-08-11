import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { buildProductsDigest } from "./_skillTools";

type ProductDigest = {
  id: string; title: string; status: string; descChars: number; images: number; imagesNoAlt: number;
  tags: number; seoTitleQuality: "missing" | "long" | "ok"; seoDescriptionQuality: "missing" | "thin" | "long" | "ok";
  seoTitleChars: number; seoDescriptionChars: number; vendor: boolean; productType: boolean; vendorName?:string; productTypeName?:string; geoReady: boolean; handle?: string;
};

export interface TechnicalGeoCheck { id:string; label:string; passed:boolean; detail:string; fix:string|null }
export interface TechnicalGeoAudit { score:number; sampledProducts:number; checks:TechnicalGeoCheck[] }

export interface SeoProduct {
  id: string;
  title: string;
  status: string;
  seoScore: number;
  geoScore: number;
  issues: string[];
  geoChecks: { label: string; passed: boolean; detail: string }[];
  vendorName: string;
  productTypeName: string;
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function crawlerBlocked(robots:string, crawler:string):boolean {
  const groups = new Map<string,string[]>();
  let agents:string[] = [], hasDirective = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/,"").trim();
    if (!line) continue;
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0,split).trim().toLowerCase(), value = line.slice(split+1).trim();
    if (key === "user-agent") {
      if (hasDirective) { agents = []; hasDirective = false; }
      agents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(),[]);
    } else if (key === "disallow") {
      hasDirective = true;
      for (const agent of agents) groups.get(agent)?.push(value);
    }
  }
  const rules = groups.get(crawler.toLowerCase()) ?? groups.get("*") ?? [];
  return rules.some(rule=>rule === "/" || rule === "/*");
}

function productNodes(value:unknown, out:Record<string,unknown>[]=[]) : Record<string,unknown>[] {
  if (Array.isArray(value)) { value.forEach(entry=>productNodes(entry,out)); return out; }
  if (!value || typeof value !== "object") return out;
  const row = value as Record<string,unknown>;
  const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
  if (types.some(type=>["product","productgroup"].includes(String(type).toLowerCase()))) out.push(row);
  Object.values(row).forEach(entry=>productNodes(entry,out));
  return out;
}

export function inspectProductPage(html:string):{canonical:boolean;indexable:boolean;productSchema:boolean;offerComplete:boolean;identityComplete:boolean} {
  const canonical = /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["'][^"']+["']/i.test(html) || /<link\b[^>]*href=["'][^"']+["'][^>]*rel=["'][^"']*canonical/i.test(html);
  const indexable = !/<meta\b[^>]*(?:name=["']robots["'][^>]*content=["'][^"']*noindex|content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'])/i.test(html);
  const nodes:Record<string,unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { productNodes(JSON.parse(match[1]),nodes); } catch { /* invalid JSON-LD is not counted */ }
  }
  const products = nodes;
  const offers = products.flatMap(product=>Array.isArray(product.offers)?product.offers:[product.offers]).find(Boolean) as Record<string,unknown>|undefined;
  const brand = products.map(product=>typeof product.brand === "object" ? (product.brand as Record<string,unknown>).name : product.brand).find(Boolean);
  return {
    canonical,
    indexable,
    productSchema:products.some(product=>Boolean(product.name && product.description && product.image)),
    offerComplete:Boolean(offers?.price && offers?.priceCurrency && offers?.availability),
    identityComplete:Boolean(brand && products.some(product=>product.sku || product.gtin || product.gtin12 || product.gtin13 || product.mpn)),
  };
}

async function publicText(url:string):Promise<{ok:boolean;text:string;url:string}> {
  try {
    const response = await fetch(url,{headers:{"User-Agent":"EvolutionGeoAudit/1.0"},redirect:"follow",signal:AbortSignal.timeout(8_000)});
    return {ok:response.ok,text:response.ok?(await response.text()).slice(0,2_000_000):"",url:response.url};
  } catch { return {ok:false,text:"",url}; }
}

export async function auditTechnicalGeo(shopDomain:string, products:ProductDigest[]):Promise<TechnicalGeoAudit> {
  const origin = `https://${shopDomain}`;
  const samples = products.filter(product=>product.status==="active"&&product.handle).slice(0,3);
  const [robots,sitemap,agents,...pages] = await Promise.all([publicText(`${origin}/robots.txt`),publicText(`${origin}/sitemap.xml`),publicText(`${origin}/agents.md`),...samples.map(product=>publicText(`${origin}/products/${encodeURIComponent(product.handle!)}`))]);
  const inspections = pages.filter(page=>page.ok).map(page=>inspectProductPage(page.text));
  const all = (key:keyof ReturnType<typeof inspectProductPage>) => inspections.length>0 && inspections.every(row=>row[key]);
  const checks:TechnicalGeoCheck[] = [
    {id:"storefront",label:"Public storefront access",passed:pages.length>0&&pages.every(page=>page.ok),detail:`${pages.filter(page=>page.ok).length}/${pages.length||0} sampled product pages reachable`,fix:pages.length&&pages.every(page=>page.ok)?null:"Publish the products to the Online Store channel and remove storefront password protection."},
    {id:"oai_searchbot",label:"ChatGPT search crawler access",passed:robots.ok&&!crawlerBlocked(robots.text,"OAI-SearchBot"),detail:!robots.ok?"robots.txt could not be read":crawlerBlocked(robots.text,"OAI-SearchBot")?"OAI-SearchBot is disallowed":"OAI-SearchBot is not blocked by robots.txt",fix:robots.ok&&!crawlerBlocked(robots.text,"OAI-SearchBot")?null:"Update Shopify robots.txt.liquid so OAI-SearchBot can crawl public product pages."},
    {id:"sitemap",label:"XML sitemap discovery",passed:sitemap.ok&&/<(?:urlset|sitemapindex)\b/i.test(sitemap.text),detail:sitemap.ok?"Shopify sitemap is reachable":"sitemap.xml could not be read",fix:sitemap.ok?null:"Confirm the storefront is public and its /sitemap.xml endpoint is reachable."},
    {id:"agent_discovery",label:"AI agent catalog file",passed:agents.ok&&agents.text.trim().length>40,detail:agents.ok?"Shopify agents.md/llms.txt discovery content is reachable":"agents.md could not be read",fix:agents.ok?null:"Add the provided templates/agents.md.liquid file to the active theme."},
    {id:"canonical",label:"Canonical and indexable product pages",passed:all("canonical")&&all("indexable"),detail:inspections.length?`${inspections.filter(row=>row.canonical&&row.indexable).length}/${inspections.length} sampled pages passed`:"No public product page could be inspected",fix:all("canonical")&&all("indexable")?null:"Fix missing canonical tags or noindex directives in the active Shopify theme."},
    {id:"product_schema",label:"Product and Offer structured data",passed:all("productSchema")&&all("offerComplete"),detail:inspections.length?`${inspections.filter(row=>row.productSchema&&row.offerComplete).length}/${inspections.length} sampled pages include core Product/Offer data`:"No structured data could be inspected",fix:all("productSchema")&&all("offerComplete")?null:"Update the product template JSON-LD with name, description, image, price, currency, and availability."},
    {id:"identifiers",label:"Brand and product identifiers in schema",passed:all("identityComplete"),detail:inspections.length?`${inspections.filter(row=>row.identityComplete).length}/${inspections.length} sampled pages include brand plus SKU/GTIN/MPN`:"No product identity schema could be inspected",fix:all("identityComplete")?null:"Add brand and valid SKU, GTIN, or MPN values and expose them in Product JSON-LD."},
    {id:"freshness",label:"Indexing freshness",passed:true,detail:"Shopify supports IndexNow for faster product-update discovery",fix:null},
  ];
  const weights:Record<string,number> = {storefront:20,oai_searchbot:15,sitemap:10,agent_discovery:5,canonical:15,product_schema:25,identifiers:5,freshness:5};
  return {score:checks.reduce((sum,check)=>sum+(check.passed?weights[check.id]??0:0),0),sampledProducts:inspections.length,checks};
}

export function analyzeSeoProduct(product: ProductDigest): SeoProduct {
  const issues: string[] = [];
  let seo = 100;
  let geo = 100;
  if (product.seoTitleQuality === "missing") { issues.push("Missing search title"); seo -= 22; }
  else if (product.seoTitleQuality === "long") { issues.push("Search title is too long"); seo -= 10; }
  if (product.seoDescriptionQuality === "missing") { issues.push("Missing meta description"); seo -= 22; }
  else if (product.seoDescriptionQuality !== "ok") { issues.push("Meta description needs stronger length"); seo -= 10; }
  if (product.descChars === 0) { issues.push("Missing product description"); seo -= 20; geo -= 30; }
  else if (product.descChars < 200) { issues.push("Product description is too thin"); seo -= 10; geo -= 18; }
  if (product.images === 0) { issues.push("No product images"); seo -= 14; geo -= 12; }
  else if (product.imagesNoAlt > 0) { issues.push(`${product.imagesNoAlt} image${product.imagesNoAlt === 1 ? "" : "s"} missing alt text`); seo -= 12; geo -= 10; }
  if (!product.productType) { issues.push("Missing product type"); geo -= 22; }
  if (!product.vendor) { issues.push("Missing vendor/brand"); geo -= 15; }
  if (product.tags < 3) { issues.push("Too few descriptive tags"); geo -= 15; }
  const geoChecks = [
    { label: "Clear product explanation", passed: product.descChars >= 200, detail: product.descChars === 0 ? "No storefront description" : `${product.descChars} characters; aim for at least 200 factual characters` },
    { label: "Entity identity", passed: product.vendor && product.productType, detail: product.vendor && product.productType ? "Brand and product type are defined" : `Missing ${[!product.vendor ? "brand/vendor" : "", !product.productType ? "product type" : ""].filter(Boolean).join(" and ")}` },
    { label: "Descriptive classification", passed: product.tags >= 3, detail: `${product.tags} descriptive tag${product.tags === 1 ? "" : "s"}` },
    { label: "Image context", passed: product.images > 0 && product.imagesNoAlt === 0, detail: product.images === 0 ? "No product images" : product.imagesNoAlt ? `${product.imagesNoAlt} sampled image${product.imagesNoAlt === 1 ? "" : "s"} missing alt text` : "Sampled images have alt text" },
  ];
  return { id: product.id, title: product.title, status: product.status, seoScore: clamp(seo), geoScore: clamp(geo), issues, geoChecks, vendorName:product.vendorName??"", productTypeName:product.productTypeName??"" };
}

export async function runSeoSnapshot(authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!(await isOperator(env, user.id, user.email))) return Response.json(OPERATOR_REQUIRED.body, { status: OPERATOR_REQUIRED.status });
  const conn = await getConnection(env, user.id);
  if (!conn) return Response.json({ error: "Connect Shopify first." }, { status: 409 });
  const digest = await buildProductsDigest(conn, 100);
  if ("error" in digest) return Response.json({ error: digest.error }, { status: 502 });
  const products = (digest.products as ProductDigest[]).map(analyzeSeoProduct).sort((a, b) => (a.seoScore + a.geoScore) - (b.seoScore + b.geoScore));
  const technicalGeo = await auditTechnicalGeo(conn.shop_domain,digest.products as ProductDigest[]);
  const average = (key: "seoScore" | "geoScore") => products.length ? Math.round(products.reduce((sum, row) => sum + row[key], 0) / products.length) : 0;
  const productGeoScore = average("geoScore");
  return Response.json({
    shop: conn.shop_domain,
    scanned: products.length,
    truncated: Boolean(digest.aggregate.truncated),
    seoScore: average("seoScore"),
    geoScore: productGeoScore,
    overallGeoScore: Math.round(productGeoScore * .6 + technicalGeo.score * .4),
    technicalGeo,
    needsWork: products.filter((row) => row.issues.length > 0).length,
    ready: products.filter((row) => row.issues.length === 0).length,
    products,
  }, { headers: { "Cache-Control": "no-store" } });
}
