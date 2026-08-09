/**
 * Shared engine for GET /api/store-products — the signed-in owner's slim live
 * catalog (title + price band + stock flag), served to the chat client so the
 * copilot can answer catalog questions from real data instead of deflecting.
 * Reuses the exact digest builder the skills use (GraphQL Admin API only);
 * returns no PII and no description bodies. dev-api.ts runs this same engine.
 */
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { buildProductsDigest } from "./_skillTools";

export interface CatalogItem {
  title: string;
  priceMin: number | null;
  priceMax: number | null;
  soldOut: boolean;
}

export async function runStoreCatalog(
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { status: 401, body: { error: "Sign in first." } };
  if (!(await isOperator(env, user.id, user.email))) return { ...OPERATOR_REQUIRED };

  const conn = await getConnection(env, user.id);
  if (!conn) return { status: 409, body: { error: "No Shopify store connected." } };

  const digest = await buildProductsDigest(conn, 100);
  if ("error" in digest) return { status: 502, body: { error: digest.error } };

  const products: CatalogItem[] = (
    digest.products as { title: string; soldOut: boolean; priceMin: number | null; priceMax: number | null }[]
  ).map((p) => ({ title: p.title, priceMin: p.priceMin, priceMax: p.priceMax, soldOut: p.soldOut }));
  const total = typeof digest.aggregate.total === "number" ? digest.aggregate.total : products.length;

  return { status: 200, body: { total, products } };
}
