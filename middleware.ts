/**
 * Vercel Edge Middleware — frame-ancestors for the embedded Shopify app.
 *
 * Shopify requires the app document to allow framing by the merchant's own
 * admin (a DYNAMIC per-shop value) and nothing else. The admin always loads
 * the app URL with ?shop=<shop>.myshopify.com, so:
 *   valid shop param  → allow that shop + admin.shopify.com to frame us
 *   anything else     → 'none' (standalone visitors get clickjack protection)
 *
 * Only the /app document needs this; the shop pattern mirrors
 * normalizeShopDomain in api/_shopify.ts (kept inline — middleware stays
 * dependency-free).
 */
import { next } from "@vercel/edge";

export const config = { matcher: ["/app", "/app.html"] };

export default function middleware(req: Request): Response {
  const shop = (new URL(req.url).searchParams.get("shop") ?? "").trim().toLowerCase();
  const isShop = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
  const csp = isShop
    ? `frame-ancestors https://${shop} https://admin.shopify.com;`
    : "frame-ancestors 'none';";
  return next({ headers: { "Content-Security-Policy": csp } });
}
