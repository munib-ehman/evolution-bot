import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { buildProductsDigest } from "./_skillTools";

type ProductDigest = {
  id: string; title: string; status: string; descChars: number; images: number; imagesNoAlt: number;
  tags: number; seoTitleQuality: "missing" | "long" | "ok"; seoDescriptionQuality: "missing" | "thin" | "long" | "ok";
  seoTitleChars: number; seoDescriptionChars: number; vendor: boolean; productType: boolean; geoReady: boolean;
};

export interface SeoProduct {
  id: string;
  title: string;
  status: string;
  seoScore: number;
  geoScore: number;
  issues: string[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

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
  return { id: product.id, title: product.title, status: product.status, seoScore: clamp(seo), geoScore: clamp(geo), issues };
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
  const average = (key: "seoScore" | "geoScore") => products.length ? Math.round(products.reduce((sum, row) => sum + row[key], 0) / products.length) : 0;
  return Response.json({
    shop: conn.shop_domain,
    scanned: products.length,
    truncated: Boolean(digest.aggregate.truncated),
    seoScore: average("seoScore"),
    geoScore: average("geoScore"),
    needsWork: products.filter((row) => row.issues.length > 0).length,
    ready: products.filter((row) => row.issues.length === 0).length,
    products,
  }, { headers: { "Cache-Control": "no-store" } });
}
