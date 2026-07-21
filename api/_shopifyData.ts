/**
 * Shared store-data fetchers — GraphQL Admin API first, REST fallback.
 *
 * Shopify legacy-blocks the REST Admin endpoints (orders.json,
 * checkouts.json, shop.json) for newly created apps — the same wall that
 * forced product reads onto GraphQL. Every reader here speaks GraphQL
 * natively and falls back to REST only for older installs where it still
 * answers. Callers get one normalized shape either way; null means both
 * paths failed (callers degrade, they don't crash).
 */
import { shopifyGet, shopifyGraphql, type ShopifyConnection } from "./_shopify";

// ---------------------------------------------------------------------------
// Orders

export interface OrderRow {
  createdAt: string;
  totalPrice: number;
  /** Stable per-customer key (GraphQL gid or REST numeric id); null when hidden. */
  customerId: string | null;
  /** Populated only when requested with { lineItems: true }. */
  lineItems: { title: string; quantity: number; price: number }[];
}

/** Same recency cap as the old REST limit=250. */
const ORDERS_CAP = 250;
/** Nested lineItems raise the GraphQL query cost — smaller pages then. */
const ORDERS_PAGE_PLAIN = 50;
const ORDERS_PAGE_WITH_ITEMS = 25;

const ordersQuery = (withItems: boolean) => `query OrdersWindow($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      currentTotalPriceSet { shopMoney { amount } }
      customer { id }
      ${withItems ? "lineItems(first: 25) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } } } }" : ""}
    }
  }
}`;

interface GqlOrdersData {
  orders?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      createdAt?: string;
      currentTotalPriceSet?: { shopMoney?: { amount?: string } } | null;
      customer?: { id?: string } | null;
      lineItems?: {
        nodes?: {
          title?: string;
          quantity?: number;
          originalUnitPriceSet?: { shopMoney?: { amount?: string } } | null;
        }[];
      };
    }[];
  };
}

const money = (amount?: string): number => {
  const n = parseFloat(amount ?? "");
  return Number.isFinite(n) ? n : 0;
};

const sinceIso = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

async function fetchOrdersGraphql(
  conn: ShopifyConnection,
  days: number,
  withItems: boolean,
): Promise<OrderRow[] | null> {
  const q = `created_at:>='${sinceIso(days)}'`;
  const pageSize = withItems ? ORDERS_PAGE_WITH_ITEMS : ORDERS_PAGE_PLAIN;
  const out: OrderRow[] = [];
  let after: string | null = null;
  while (out.length < ORDERS_CAP) {
    const data: GqlOrdersData | null = await shopifyGraphql<GqlOrdersData>(
      conn.shop_domain,
      conn.access_token,
      ordersQuery(withItems),
      { first: Math.min(pageSize, ORDERS_CAP - out.length), after, q },
    );
    const page: GqlOrdersData["orders"] = data?.orders;
    if (!page?.nodes) return out.length === 0 ? null : out; // partial > nothing
    for (const n of page.nodes) {
      out.push({
        createdAt: n.createdAt ?? "",
        totalPrice: money(n.currentTotalPriceSet?.shopMoney?.amount),
        customerId: n.customer?.id ?? null,
        lineItems: (n.lineItems?.nodes ?? []).map((li) => ({
          title: (li.title ?? "").trim() || "(untitled)",
          quantity: li.quantity ?? 0,
          price: money(li.originalUnitPriceSet?.shopMoney?.amount),
        })),
      });
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

interface RestOrder {
  total_price?: string;
  created_at?: string;
  customer?: { id?: number } | null;
  line_items?: { title?: string; quantity?: number; price?: string }[];
}

async function fetchOrdersRest(
  conn: ShopifyConnection,
  days: number,
  withItems: boolean,
): Promise<OrderRow[] | null> {
  const since = encodeURIComponent(sinceIso(days));
  const fields = withItems
    ? "id,total_price,created_at,customer,line_items"
    : "id,total_price,created_at,customer";
  const res = await shopifyGet<{ orders?: RestOrder[] }>(
    conn.shop_domain,
    conn.access_token,
    `orders.json?status=any&limit=250&created_at_min=${since}&fields=${fields}`,
  );
  if (!res?.orders) return null;
  return res.orders.map((o) => ({
    createdAt: o.created_at ?? "",
    totalPrice: parseFloat(o.total_price ?? "0") || 0,
    customerId: typeof o.customer?.id === "number" ? String(o.customer.id) : null,
    lineItems: (o.line_items ?? []).map((li) => ({
      title: (li.title ?? "").trim() || "(untitled)",
      quantity: li.quantity ?? 0,
      price: parseFloat(li.price ?? "0") || 0,
    })),
  }));
}

/** Orders in the last N days (capped at 250, newest first). Null = both APIs failed. */
export async function fetchOrdersWindow(
  conn: ShopifyConnection,
  days: number,
  opts: { lineItems?: boolean } = {},
): Promise<OrderRow[] | null> {
  const withItems = opts.lineItems ?? false;
  return (
    (await fetchOrdersGraphql(conn, days, withItems)) ?? (await fetchOrdersRest(conn, days, withItems))
  );
}

// ---------------------------------------------------------------------------
// Abandoned checkouts

export interface CheckoutRow {
  createdAt: string;
  totalPrice: number;
  /** Shopper left an email → recoverable. May undercount if customer data is access-restricted. */
  hasEmail: boolean;
  itemCount: number;
}

const CHECKOUTS_QUERY = `query AbandonedCheckoutsWindow($first: Int!, $after: String, $q: String) {
  abandonedCheckouts(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      totalPriceSet { shopMoney { amount } }
      lineItemsQuantity
      customer { email }
    }
  }
}`;

interface GqlCheckoutsData {
  abandonedCheckouts?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      createdAt?: string;
      totalPriceSet?: { shopMoney?: { amount?: string } } | null;
      lineItemsQuantity?: number;
      customer?: { email?: string | null } | null;
    }[];
  };
}

const CHECKOUTS_CAP = 250;
const CHECKOUTS_PAGE = 50;

async function fetchCheckoutsGraphql(conn: ShopifyConnection, days: number): Promise<CheckoutRow[] | null> {
  const q = `created_at:>='${sinceIso(days)}'`;
  const out: CheckoutRow[] = [];
  let after: string | null = null;
  while (out.length < CHECKOUTS_CAP) {
    const data: GqlCheckoutsData | null = await shopifyGraphql<GqlCheckoutsData>(
      conn.shop_domain,
      conn.access_token,
      CHECKOUTS_QUERY,
      { first: Math.min(CHECKOUTS_PAGE, CHECKOUTS_CAP - out.length), after, q },
    );
    const page: GqlCheckoutsData["abandonedCheckouts"] = data?.abandonedCheckouts;
    if (!page?.nodes) return out.length === 0 ? null : out;
    for (const n of page.nodes) {
      out.push({
        createdAt: n.createdAt ?? "",
        totalPrice: money(n.totalPriceSet?.shopMoney?.amount),
        hasEmail: (n.customer?.email ?? "").includes("@"),
        itemCount: n.lineItemsQuantity ?? 0,
      });
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

async function fetchCheckoutsRest(conn: ShopifyConnection, days: number): Promise<CheckoutRow[] | null> {
  const since = encodeURIComponent(sinceIso(days));
  const res = await shopifyGet<{
    checkouts?: { total_price?: string; created_at?: string; email?: string; line_items?: unknown[] }[];
  }>(conn.shop_domain, conn.access_token, `checkouts.json?limit=250&created_at_min=${since}`);
  if (!res?.checkouts) return null;
  return res.checkouts.map((c) => ({
    createdAt: c.created_at ?? "",
    totalPrice: parseFloat(c.total_price ?? "0") || 0,
    hasEmail: (c.email ?? "").includes("@"),
    itemCount: c.line_items?.length ?? 0,
  }));
}

/** Abandoned checkouts in the last N days (capped at 250). Null = both APIs failed. */
export async function fetchAbandonedCheckoutsWindow(
  conn: ShopifyConnection,
  days: number,
): Promise<CheckoutRow[] | null> {
  return (await fetchCheckoutsGraphql(conn, days)) ?? (await fetchCheckoutsRest(conn, days));
}

// ---------------------------------------------------------------------------
// Recoverable checkouts — the ONE fetcher that returns customer PII.
//
// Names/emails/recovery links flow Shopify → server → the OWNER's browser
// only (via /api/recovery-carts). They must never enter LLM context or the
// skill/agent tool digests — those use fetchAbandonedCheckoutsWindow above.

export interface RecoverableCart {
  id: string;
  createdAt: string;
  totalPrice: number;
  /** Shopify's magic link that restores the cart at checkout. */
  recoveryUrl: string;
  firstName: string;
  /** Empty string when the shopper left no email (or access is restricted). */
  email: string;
  items: { title: string; qty: number }[];
}

const RECOVERY_QUERY = `query RecoverableCheckouts($first: Int!, $after: String, $q: String) {
  abandonedCheckouts(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      abandonedCheckoutUrl
      totalPriceSet { shopMoney { amount } }
      customer { firstName email }
      lineItems(first: 10) { nodes { title quantity } }
    }
  }
}`;

interface GqlRecoveryData {
  abandonedCheckouts?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string;
      createdAt?: string;
      abandonedCheckoutUrl?: string | null;
      totalPriceSet?: { shopMoney?: { amount?: string } } | null;
      customer?: { firstName?: string | null; email?: string | null } | null;
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
    }[];
  };
}

async function fetchRecoveryGraphql(conn: ShopifyConnection, days: number): Promise<RecoverableCart[] | null> {
  const q = `created_at:>='${sinceIso(days)}'`;
  const out: RecoverableCart[] = [];
  let after: string | null = null;
  while (out.length < CHECKOUTS_CAP) {
    const data: GqlRecoveryData | null = await shopifyGraphql<GqlRecoveryData>(
      conn.shop_domain,
      conn.access_token,
      RECOVERY_QUERY,
      { first: Math.min(CHECKOUTS_PAGE, CHECKOUTS_CAP - out.length), after, q },
    );
    const page: GqlRecoveryData["abandonedCheckouts"] = data?.abandonedCheckouts;
    if (!page?.nodes) return out.length === 0 ? null : out;
    for (const n of page.nodes) {
      out.push({
        id: n.id ?? "",
        createdAt: n.createdAt ?? "",
        totalPrice: money(n.totalPriceSet?.shopMoney?.amount),
        recoveryUrl: n.abandonedCheckoutUrl ?? "",
        firstName: (n.customer?.firstName ?? "").trim(),
        email: (n.customer?.email ?? "").trim(),
        items: (n.lineItems?.nodes ?? []).map((li) => ({
          title: (li.title ?? "").trim() || "(untitled)",
          qty: li.quantity ?? 0,
        })),
      });
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

async function fetchRecoveryRest(conn: ShopifyConnection, days: number): Promise<RecoverableCart[] | null> {
  const since = encodeURIComponent(sinceIso(days));
  const res = await shopifyGet<{
    checkouts?: {
      id?: number;
      created_at?: string;
      completed_at?: string | null;
      total_price?: string;
      abandoned_checkout_url?: string;
      email?: string;
      customer?: { first_name?: string | null } | null;
      line_items?: { title?: string; quantity?: number }[];
    }[];
  }>(conn.shop_domain, conn.access_token, `checkouts.json?limit=250&created_at_min=${since}`);
  if (!res?.checkouts) return null;
  return res.checkouts
    .filter((c) => !c.completed_at)
    .map((c) => ({
      id: String(c.id ?? ""),
      createdAt: c.created_at ?? "",
      totalPrice: parseFloat(c.total_price ?? "0") || 0,
      recoveryUrl: c.abandoned_checkout_url ?? "",
      firstName: (c.customer?.first_name ?? "").trim(),
      email: (c.email ?? "").trim(),
      items: (c.line_items ?? []).map((li) => ({
        title: (li.title ?? "").trim() || "(untitled)",
        qty: li.quantity ?? 0,
      })),
    }));
}

/** Abandoned carts with customer + recovery detail (PII — owner's eyes only). */
export async function fetchRecoverableCheckouts(
  conn: ShopifyConnection,
  days: number,
): Promise<RecoverableCart[] | null> {
  return (await fetchRecoveryGraphql(conn, days)) ?? (await fetchRecoveryRest(conn, days));
}

// ---------------------------------------------------------------------------
// Shop info

/** The store's currency code, or null if both APIs failed. */
export async function fetchShopCurrency(conn: ShopifyConnection): Promise<string | null> {
  const data = await shopifyGraphql<{ shop?: { currencyCode?: string } }>(
    conn.shop_domain,
    conn.access_token,
    "query ShopCurrency { shop { currencyCode } }",
    {},
  );
  if (data?.shop?.currencyCode) return data.shop.currencyCode;
  const rest = await shopifyGet<{ shop?: { currency?: string } }>(
    conn.shop_domain,
    conn.access_token,
    "shop.json",
  );
  return rest?.shop?.currency ?? null;
}
