import type { TechnicalGeoCheck } from "./seo";

export type GeoRepairFile = { name:string; content:string; label:string; location:string };

const ROBOTS = `{% comment %}Evolution GEO repair: preserve Shopify defaults and explicitly allow ChatGPT Search.{% endcomment %}
{% for group in robots.default_groups %}
{{- group.user_agent -}}
{% for rule in group.rules %}
{{- rule -}}
{% endfor %}
{%- if group.sitemap != blank -%}
{{ group.sitemap }}
{%- endif -%}
{% endfor %}

User-agent: OAI-SearchBot
Allow: /
`;

const PRODUCT_SCHEMA = `{% comment %}
  Evolution GEO repair. Render this snippet once inside layout/theme.liquid <head>.
  Do not install it when your theme already outputs valid Product structured data.
{% endcomment %}
{% if request.page_type == 'product' and product != blank %}
  <script type="application/ld+json">
    {{ product | structured_data }}
  </script>
{% endif %}
`;

const AGENTS = `# {{ shop.name }}

> {{ shop.description | strip_html | strip_newlines | default: 'Official online store and product catalog.' }}

- Store: {{ shop.url }}
- Product catalog: {{ shop.url }}{{ routes.collections_url }}/all
- Sitemap: {{ shop.url }}/sitemap.xml

## Products

{% paginate collections.all.products by 50 %}
{% for product in collections.all.products %}
- [{{ product.title }}]({{ shop.url }}{{ product.url }}){% if product.vendor != blank %} — {{ product.vendor }}{% endif %}{% if product.type != blank %}; {{ product.type }}{% endif %}. {{ product.description | strip_html | strip_newlines | truncate: 240 }}
{% endfor %}
{% endpaginate %}

Product prices, availability, options, policies, and descriptions on the linked product pages are authoritative and may change.
`;

export function repairReadme(shop:string, checks:TechnicalGeoCheck[]):string {
  const failed = checks.filter(check=>!check.passed);
  return `# Evolution Shopify SEO + GEO repair kit

Store: ${shop}
Generated: ${new Date().toISOString()}

## Important safety step

Duplicate your live theme before editing it. Install only the files matching failed Evolution checks. Preview the duplicate theme and run Evolution's audit again before publishing it.

## Current failed checks

${failed.length?failed.map(check=>`- ${check.label}: ${check.detail}\n  Fix: ${check.fix??"Follow the instructions below."}`).join("\n"):"- None. Keep this kit as a reference; do not add duplicate markup to a passing theme."}

## Installation

### ChatGPT crawler access

Use only when the OAI-SearchBot check fails.

1. Shopify Admin > Online Store > Themes.
2. Duplicate the active theme, then choose Edit code on the duplicate.
3. Under Templates, create or replace robots.txt.liquid with templates/robots.txt.liquid from this kit.
4. Preview /robots.txt and confirm Shopify's default rules remain present plus the OAI-SearchBot allow group.

### Product structured data

Use only when Product and Offer structured data fails. Do not install a second Product JSON-LD block when a valid one already exists.

1. Add snippets/evolution-product-structured-data.liquid.
2. Open layout/theme.liquid.
3. Immediately before </head>, add: {% render 'evolution-product-structured-data' %}
4. Preview a product and validate its URL with Google's Rich Results Test.

This uses Shopify's official product | structured_data filter, so product title, description, images, variants, prices, availability, brand, and identifiers remain dynamic.

### AI agent catalog

Shopify now generates /agents.md, /llms.txt and /llms-full.txt by default. Install templates/agents.md.liquid only when Evolution cannot read useful content at /agents.md or when you intentionally want the catalog format included in this kit.

## Validation

- Re-run Evolution's SEO Manager audit.
- Check /robots.txt, /sitemap.xml, /agents.md, and a public product URL.
- Confirm there is one authoritative Product/ProductGroup JSON-LD representation, not conflicting duplicates.
- Publish the duplicate theme only after preview validation passes.
`;
}

function crc32(bytes:Uint8Array):number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0;bit<8;bit++) crc = (crc>>>1) ^ (crc&1?0xedb88320:0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16=(value:number)=>new Uint8Array([value&255,(value>>>8)&255]);
const u32=(value:number)=>new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]);
function join(parts:Uint8Array[]):Uint8Array {
  const output=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));
  let offset=0; for(const part of parts){output.set(part,offset);offset+=part.length;} return output;
}

function zip(files:GeoRepairFile[]):Blob {
  const encoder=new TextEncoder(), locals:Uint8Array[]=[], centrals:Uint8Array[]=[];
  let offset=0;
  for(const file of files){
    const name=encoder.encode(file.name),data=encoder.encode(file.content),crc=crc32(data);
    const local=join([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
    const central=join([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);
    locals.push(local);centrals.push(central);offset+=local.length;
  }
  const directory=join(centrals),end=join([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(offset),u16(0)]);
  const archive=join([...locals,directory,end]);
  return new Blob([archive.buffer as ArrayBuffer],{type:"application/zip"});
}

export function requiredGeoRepairFiles(checks:TechnicalGeoCheck[]):GeoRepairFile[] {
  const failed=new Set(checks.filter(check=>!check.passed).map(check=>check.id));
  const files:GeoRepairFile[]=[];
  if(failed.has("oai_searchbot")) files.push({name:"templates/robots.txt.liquid",content:ROBOTS,label:"Allow ChatGPT Search",location:"Templates > robots.txt.liquid"});
  if(failed.has("product_schema")) files.push({name:"snippets/evolution-product-structured-data.liquid",content:PRODUCT_SCHEMA,label:"Add product structured data",location:"Snippets > evolution-product-structured-data.liquid"});
  if(failed.has("agent_discovery")) files.push({name:"templates/agents.md.liquid",content:AGENTS,label:"Add the AI catalog file",location:"Templates > agents.md.liquid"});
  return files;
}

export function downloadGeoFixKit(shop:string, checks:TechnicalGeoCheck[]):void {
  const files=requiredGeoRepairFiles(checks);
  if(!files.length)return;
  const safeShop=shop.replace(/[^a-z0-9.-]/gi,"-");
  const blob=files.length===1?new Blob([files[0].content],{type:"text/plain;charset=utf-8"}):zip(files);
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=files.length===1?files[0].name.split("/").pop()!:`evolution-geo-fixes-${safeShop}.zip`;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1_000);
}
