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
import {
  shopifyGet,
  shopifyGetDetailed,
  shopifyGraphql,
  shopifyGraphqlDetailed,
  type ShopifyConnection,
} from "./_shopify";

/**
 * PII fetchers resolve to this: rows, null (both APIs failed), or
 * "access-denied" — Shopify refused because the app lacks protected-customer-
 * data access (Partner Dashboard toggle). Callers turn the sentinel into a
 * tells-you-exactly-what-to-enable message instead of a generic failure.
 */
export type PiiResult<T> = T[] | null | "access-denied";

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
  /** Product titles only (sampled, first 10) — no customer fields, safe for LLM context. */
  items: { title: string; qty: number }[];
}

const CHECKOUTS_QUERY = `query AbandonedCheckoutsWindow($first: Int!, $after: String, $q: String) {
  abandonedCheckouts(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      totalPriceSet { shopMoney { amount } }
      lineItemsQuantity
      customer { email }
      lineItems(first: 10) { nodes { title quantity } }
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
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
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

async function fetchCheckoutsRest(conn: ShopifyConnection, days: number): Promise<CheckoutRow[] | null> {
  const since = encodeURIComponent(sinceIso(days));
  const res = await shopifyGet<{
    checkouts?: {
      total_price?: string;
      created_at?: string;
      email?: string;
      line_items?: { title?: string; quantity?: number }[];
    }[];
  }>(conn.shop_domain, conn.access_token, `checkouts.json?limit=250&created_at_min=${since}`);
  if (!res?.checkouts) return null;
  return res.checkouts.map((c) => ({
    createdAt: c.created_at ?? "",
    totalPrice: parseFloat(c.total_price ?? "0") || 0,
    hasEmail: (c.email ?? "").includes("@"),
    itemCount: c.line_items?.length ?? 0,
    items: (c.line_items ?? []).slice(0, 10).map((li) => ({
      title: (li.title ?? "").trim() || "(untitled)",
      qty: li.quantity ?? 0,
    })),
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

async function fetchRecoveryGraphql(
  conn: ShopifyConnection,
  days: number,
): Promise<PiiResult<RecoverableCart>> {
  const q = `created_at:>='${sinceIso(days)}'`;
  const out: RecoverableCart[] = [];
  let after: string | null = null;
  while (out.length < CHECKOUTS_CAP) {
    const { data, accessDenied }: { data: GqlRecoveryData | null; accessDenied: boolean } =
      await shopifyGraphqlDetailed<GqlRecoveryData>(conn.shop_domain, conn.access_token, RECOVERY_QUERY, {
        first: Math.min(CHECKOUTS_PAGE, CHECKOUTS_CAP - out.length),
        after,
        q,
      });
    if (accessDenied) return "access-denied";
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

async function fetchRecoveryRest(
  conn: ShopifyConnection,
  days: number,
): Promise<PiiResult<RecoverableCart>> {
  const since = encodeURIComponent(sinceIso(days));
  const { status, data: res } = await shopifyGetDetailed<{
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
  if (status === 403) return "access-denied";
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
): Promise<PiiResult<RecoverableCart>> {
  const gql = await fetchRecoveryGraphql(conn, days);
  if (gql !== null) return gql; // rows or "access-denied" — REST would 403 on the same wall
  return fetchRecoveryRest(conn, days);
}

// ---------------------------------------------------------------------------
// Retention: lapsed customers + recent buyers — PII, owner's eyes only.
//
// Same rule as fetchRecoverableCheckouts: names/emails flow Shopify → server
// → the OWNER's browser (via /api/retention-customers). They must never enter
// LLM context or the skill/agent tool digests — the retention draft prompt
// only ever sees counts and sums.

export interface LapsedCustomer {
  id: string;
  firstName: string;
  /** Empty when the customer left no email (or access is restricted). */
  email: string;
  lastOrderAt: string;
  /** Lifetime on the GraphQL path; within the lookback window on REST fallback. */
  ordersCount: number;
  totalSpent: number;
  lastItems: { title: string; qty: number }[];
}

export interface RecentBuyer {
  orderId: string;
  customerId: string | null;
  firstName: string;
  email: string;
  orderedAt: string;
  totalPrice: number;
  items: { title: string; qty: number }[];
}

/**
 * CustomerSortKeys has no last-order sort (verified on 2026-04), so we scan
 * the customer list oldest-created-first — lapsed customers skew old — read
 * each one's lastOrder date, and filter in code. Capped scan; small stores
 * fit comfortably. (Nested lineItems raise query cost → smaller pages.)
 */
const LAPSED_PAGE = 50;
const LAPSED_SCAN_CAP = 300;
const LAPSED_COLLECT_CAP = 150;

const LAPSED_QUERY = `query LapsedCustomers($first: Int!, $after: String) {
  customers(first: $first, after: $after, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      firstName
      defaultEmailAddress { emailAddress }
      numberOfOrders
      amountSpent { amount }
      lastOrder {
        createdAt
        lineItems(first: 5) { nodes { title quantity } }
      }
    }
  }
}`;

interface GqlLapsedData {
  customers?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string;
      firstName?: string | null;
      defaultEmailAddress?: { emailAddress?: string | null } | null;
      numberOfOrders?: string | number;
      amountSpent?: { amount?: string } | null;
      lastOrder?: {
        createdAt?: string;
        lineItems?: { nodes?: { title?: string; quantity?: number }[] };
      } | null;
    }[];
  };
}

const daysAgo = (iso: string): number => (Date.now() - Date.parse(iso)) / (24 * 3600 * 1000);

async function fetchLapsedGraphql(
  conn: ShopifyConnection,
  minDays: number,
  maxDays: number,
): Promise<PiiResult<LapsedCustomer>> {
  const out: LapsedCustomer[] = [];
  let scanned = 0;
  let after: string | null = null;
  while (scanned < LAPSED_SCAN_CAP && out.length < LAPSED_COLLECT_CAP) {
    const { data, accessDenied }: { data: GqlLapsedData | null; accessDenied: boolean } =
      await shopifyGraphqlDetailed<GqlLapsedData>(conn.shop_domain, conn.access_token, LAPSED_QUERY, {
        first: LAPSED_PAGE,
        after,
      });
    if (accessDenied) return "access-denied";
    const page: GqlLapsedData["customers"] = data?.customers;
    if (!page?.nodes) return out.length === 0 ? null : out; // partial > nothing
    for (const n of page.nodes) {
      scanned++;
      const lastAt = n.lastOrder?.createdAt;
      if (!lastAt) continue; // never ordered
      const age = daysAgo(lastAt);
      if (!Number.isFinite(age) || age < minDays || age > maxDays) continue;
      out.push({
        id: n.id ?? "",
        firstName: (n.firstName ?? "").trim(),
        email: (n.defaultEmailAddress?.emailAddress ?? "").trim(),
        lastOrderAt: lastAt,
        ordersCount: Number(n.numberOfOrders) || 0,
        totalSpent: money(n.amountSpent?.amount),
        lastItems: (n.lastOrder?.lineItems?.nodes ?? []).map((li) => ({
          title: (li.title ?? "").trim() || "(untitled)",
          qty: li.quantity ?? 0,
        })),
      });
      if (out.length >= LAPSED_COLLECT_CAP) break;
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

interface RestRetentionOrder {
  id?: number;
  created_at?: string;
  cancelled_at?: string | null;
  financial_status?: string;
  total_price?: string;
  email?: string;
  customer?: { id?: number; first_name?: string | null } | null;
  line_items?: { title?: string; quantity?: number }[];
}

async function fetchRetentionOrdersRest(
  conn: ShopifyConnection,
  minDays: number,
  maxDays: number,
): Promise<PiiResult<RestRetentionOrder>> {
  const min = encodeURIComponent(sinceIso(maxDays));
  const max = minDays > 0 ? `&created_at_max=${encodeURIComponent(sinceIso(minDays))}` : "";
  const { status, data } = await shopifyGetDetailed<{ orders?: RestRetentionOrder[] }>(
    conn.shop_domain,
    conn.access_token,
    `orders.json?status=any&limit=250&created_at_min=${min}${max}&fields=id,created_at,cancelled_at,financial_status,total_price,email,customer,line_items`,
  );
  if (status === 403) return "access-denied";
  return data?.orders ?? null;
}

/**
 * REST fallback: customers.json has no last-order DATE, so derive lapsed
 * customers from one 250-order window instead — fine for the small stores
 * this path serves, but ordersCount/totalSpent shrink to within-window.
 */
async function fetchLapsedRest(
  conn: ShopifyConnection,
  minDays: number,
  maxDays: number,
): Promise<PiiResult<LapsedCustomer>> {
  const orders = await fetchRetentionOrdersRest(conn, 0, maxDays);
  if (orders === "access-denied" || orders === null) return orders;
  const byCustomer = new Map<string, { latest: RestRetentionOrder; count: number; spent: number }>();
  for (const o of orders) {
    if (o.cancelled_at) continue;
    const key = o.customer?.id != null ? String(o.customer.id) : (o.email ?? "").toLowerCase();
    if (!key) continue;
    const cur = byCustomer.get(key);
    const latest =
      !cur || Date.parse(o.created_at ?? "") > Date.parse(cur.latest.created_at ?? "") ? o : cur?.latest;
    byCustomer.set(key, {
      latest: latest ?? o,
      count: (cur?.count ?? 0) + 1,
      spent: (cur?.spent ?? 0) + (parseFloat(o.total_price ?? "0") || 0),
    });
  }
  const out: LapsedCustomer[] = [];
  for (const [key, c] of byCustomer) {
    const lastAt = c.latest.created_at ?? "";
    const age = daysAgo(lastAt);
    if (!Number.isFinite(age) || age < minDays || age > maxDays) continue;
    out.push({
      id: key,
      firstName: (c.latest.customer?.first_name ?? "").trim(),
      email: (c.latest.email ?? "").trim(),
      lastOrderAt: lastAt,
      ordersCount: c.count,
      totalSpent: c.spent,
      lastItems: (c.latest.line_items ?? []).slice(0, 5).map((li) => ({
        title: (li.title ?? "").trim() || "(untitled)",
        qty: li.quantity ?? 0,
      })),
    });
  }
  return out.sort((a, b) => Date.parse(b.lastOrderAt) - Date.parse(a.lastOrderAt));
}

/** Customers whose last order fell out of the window (PII — owner's eyes only). */
export async function fetchLapsedCustomers(
  conn: ShopifyConnection,
  opts: { minDays: number; maxDays: number },
): Promise<PiiResult<LapsedCustomer>> {
  const gql = await fetchLapsedGraphql(conn, opts.minDays, opts.maxDays);
  const rows = gql !== null ? gql : await fetchLapsedRest(conn, opts.minDays, opts.maxDays);
  if (rows === "access-denied" || rows === null) return rows;
  // Most recently lapsed first — the easiest customers to win back on top.
  return rows.sort((a, b) => Date.parse(b.lastOrderAt) - Date.parse(a.lastOrderAt));
}

const BUYERS_PAGE = 25;
const BUYERS_CAP = 250;

const BUYERS_QUERY = `query RecentBuyers($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      cancelledAt
      displayFinancialStatus
      email
      customer { id firstName }
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { title quantity } }
    }
  }
}`;

interface GqlBuyersData {
  orders?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string;
      createdAt?: string;
      cancelledAt?: string | null;
      displayFinancialStatus?: string | null;
      email?: string | null;
      customer?: { id?: string; firstName?: string | null } | null;
      currentTotalPriceSet?: { shopMoney?: { amount?: string } } | null;
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
    }[];
  };
}

const REFUNDED_STATUSES = new Set(["REFUNDED", "VOIDED", "refunded", "voided"]);

function dedupeBuyers(rows: RecentBuyer[]): RecentBuyer[] {
  // Newest-first input: the first row seen per customer is their latest order.
  const seen = new Set<string>();
  const out: RecentBuyer[] = [];
  for (const r of rows) {
    const key = r.customerId ?? r.email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function fetchBuyersGraphql(
  conn: ShopifyConnection,
  minDays: number,
  maxDays: number,
): Promise<PiiResult<RecentBuyer>> {
  const q = `created_at:>='${sinceIso(maxDays)}' AND created_at:<='${sinceIso(minDays)}'`;
  const out: RecentBuyer[] = [];
  let after: string | null = null;
  while (out.length < BUYERS_CAP) {
    const { data, accessDenied }: { data: GqlBuyersData | null; accessDenied: boolean } =
      await shopifyGraphqlDetailed<GqlBuyersData>(conn.shop_domain, conn.access_token, BUYERS_QUERY, {
        first: Math.min(BUYERS_PAGE, BUYERS_CAP - out.length),
        after,
        q,
      });
    if (accessDenied) return "access-denied";
    const page: GqlBuyersData["orders"] = data?.orders;
    if (!page?.nodes) return out.length === 0 ? null : dedupeBuyers(out);
    for (const n of page.nodes) {
      if (n.cancelledAt || REFUNDED_STATUSES.has(n.displayFinancialStatus ?? "")) continue;
      out.push({
        orderId: n.id ?? "",
        customerId: n.customer?.id ?? null,
        firstName: (n.customer?.firstName ?? "").trim(),
        email: (n.email ?? "").trim(),
        orderedAt: n.createdAt ?? "",
        totalPrice: money(n.currentTotalPriceSet?.shopMoney?.amount),
        items: (n.lineItems?.nodes ?? []).map((li) => ({
          title: (li.title ?? "").trim() || "(untitled)",
          qty: li.quantity ?? 0,
        })),
      });
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return dedupeBuyers(out);
}

async function fetchBuyersRest(
  conn: ShopifyConnection,
  minDays: number,
  maxDays: number,
): Promise<PiiResult<RecentBuyer>> {
  const orders = await fetchRetentionOrdersRest(conn, minDays, maxDays);
  if (orders === "access-denied" || orders === null) return orders;
  const rows: RecentBuyer[] = orders
    .filter((o) => !o.cancelled_at && !REFUNDED_STATUSES.has(o.financial_status ?? ""))
    .map((o) => ({
      orderId: String(o.id ?? ""),
      customerId: o.customer?.id != null ? String(o.customer.id) : null,
      firstName: (o.customer?.first_name ?? "").trim(),
      email: (o.email ?? "").trim(),
      orderedAt: o.created_at ?? "",
      totalPrice: parseFloat(o.total_price ?? "0") || 0,
      items: (o.line_items ?? []).map((li) => ({
        title: (li.title ?? "").trim() || "(untitled)",
        qty: li.quantity ?? 0,
      })),
    }))
    .sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));
  return dedupeBuyers(rows);
}

/**
 * Buyers whose order is old enough to have arrived but recent enough to
 * review — one row per customer, latest order wins (PII — owner's eyes only).
 */
export async function fetchRecentBuyers(
  conn: ShopifyConnection,
  opts: { minDays: number; maxDays: number },
): Promise<PiiResult<RecentBuyer>> {
  const gql = await fetchBuyersGraphql(conn, opts.minDays, opts.maxDays);
  if (gql !== null) return gql;
  return fetchBuyersRest(conn, opts.minDays, opts.maxDays);
}

// ---------------------------------------------------------------------------
// Operations: inventory watch + ship queue. Non-PII — product titles,
// quantities, order numbers only; no customer fields, safe for any surface.

export interface InventoryProduct {
  title: string;
  totalInventory: number;
  /** Every tracked variant at/under zero with oversell denied. */
  soldOut: boolean;
  /** Tracked, in stock, but at/under the low-stock threshold. */
  lowStock: boolean;
  /** Variant-level detail for the low/out lists (sampled, first 10). */
  variants: { title: string; qty: number; tracked: boolean }[];
}

export interface ShipQueueOrder {
  /** The order number the owner sees in Shopify admin, e.g. "#1001". */
  name: string;
  createdAt: string;
  financialStatus: string;
  totalPrice: number;
  items: { title: string; qty: number }[];
}

const INVENTORY_LOW_THRESHOLD = 5;
const INVENTORY_PAGE = 25;
const INVENTORY_CAP = 100;

const INVENTORY_QUERY = `query InventoryWatch($first: Int!, $after: String) {
  products(first: $first, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      title
      totalInventory
      tracksInventory
      variants(first: 10) {
        nodes {
          title
          inventoryQuantity
          inventoryPolicy
          inventoryItem { tracked }
        }
      }
    }
  }
}`;

interface GqlInventoryData {
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      title?: string;
      totalInventory?: number;
      tracksInventory?: boolean;
      variants?: {
        nodes?: {
          title?: string;
          inventoryQuantity?: number;
          inventoryPolicy?: string;
          inventoryItem?: { tracked?: boolean } | null;
        }[];
      };
    }[];
  };
}

function classifyInventory(p: {
  title: string;
  totalInventory: number;
  variants: { title: string; qty: number; tracked: boolean; oversells: boolean }[];
}): InventoryProduct {
  const tracked = p.variants.filter((v) => v.tracked);
  const soldOut =
    p.variants.length > 0 &&
    tracked.length === p.variants.length &&
    tracked.every((v) => v.qty <= 0 && !v.oversells);
  const lowStock =
    !soldOut && tracked.length > 0 && p.totalInventory > 0 && p.totalInventory <= INVENTORY_LOW_THRESHOLD;
  return {
    title: p.title,
    totalInventory: p.totalInventory,
    soldOut,
    lowStock,
    variants: p.variants.map(({ title, qty, tracked: t }) => ({ title, qty, tracked: t })),
  };
}

async function fetchInventoryGraphql(conn: ShopifyConnection): Promise<InventoryProduct[] | null> {
  const out: InventoryProduct[] = [];
  let after: string | null = null;
  while (out.length < INVENTORY_CAP) {
    const data: GqlInventoryData | null = await shopifyGraphql<GqlInventoryData>(
      conn.shop_domain,
      conn.access_token,
      INVENTORY_QUERY,
      { first: Math.min(INVENTORY_PAGE, INVENTORY_CAP - out.length), after },
    );
    const page: GqlInventoryData["products"] = data?.products;
    if (!page?.nodes) return out.length === 0 ? null : out; // partial > nothing
    for (const n of page.nodes) {
      out.push(
        classifyInventory({
          title: (n.title ?? "").trim() || "(untitled)",
          totalInventory: n.totalInventory ?? 0,
          variants: (n.variants?.nodes ?? []).map((v) => ({
            title: (v.title ?? "").trim(),
            qty: v.inventoryQuantity ?? 0,
            tracked: v.inventoryItem?.tracked ?? false,
            oversells: v.inventoryPolicy === "CONTINUE",
          })),
        }),
      );
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

async function fetchInventoryRest(conn: ShopifyConnection): Promise<InventoryProduct[] | null> {
  const res = await shopifyGet<{
    products?: {
      title?: string;
      status?: string;
      variants?: {
        title?: string;
        inventory_quantity?: number;
        inventory_policy?: string;
        inventory_management?: string | null;
      }[];
    }[];
  }>(conn.shop_domain, conn.access_token, "products.json?limit=100&status=active&fields=title,status,variants");
  if (!res?.products) return null;
  return res.products.map((p) => {
    const variants = (p.variants ?? []).map((v) => ({
      title: (v.title ?? "").trim(),
      qty: v.inventory_quantity ?? 0,
      tracked: !!v.inventory_management,
      oversells: v.inventory_policy === "continue",
    }));
    return classifyInventory({
      title: (p.title ?? "").trim() || "(untitled)",
      totalInventory: variants.reduce((n, v) => n + (v.tracked ? v.qty : 0), 0),
      variants,
    });
  });
}

/** Active products with stock classification (capped at 100). Null = both APIs failed. */
export async function fetchInventoryWatch(conn: ShopifyConnection): Promise<InventoryProduct[] | null> {
  return (await fetchInventoryGraphql(conn)) ?? (await fetchInventoryRest(conn));
}

const SHIP_QUEUE_CAP = 50;

const SHIP_QUEUE_QUERY = `query ShipQueue($first: Int!, $after: String) {
  orders(first: $first, after: $after, query: "fulfillment_status:unshipped", sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      cancelledAt
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { title quantity } }
    }
  }
}`;

interface GqlShipQueueData {
  orders?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      name?: string;
      createdAt?: string;
      cancelledAt?: string | null;
      displayFinancialStatus?: string | null;
      currentTotalPriceSet?: { shopMoney?: { amount?: string } } | null;
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
    }[];
  };
}

async function fetchShipQueueGraphql(conn: ShopifyConnection): Promise<ShipQueueOrder[] | null> {
  const out: ShipQueueOrder[] = [];
  let after: string | null = null;
  while (out.length < SHIP_QUEUE_CAP) {
    const data: GqlShipQueueData | null = await shopifyGraphql<GqlShipQueueData>(
      conn.shop_domain,
      conn.access_token,
      SHIP_QUEUE_QUERY,
      { first: Math.min(25, SHIP_QUEUE_CAP - out.length), after },
    );
    const page: GqlShipQueueData["orders"] = data?.orders;
    if (!page?.nodes) return out.length === 0 ? null : out;
    for (const n of page.nodes) {
      if (n.cancelledAt) continue;
      out.push({
        name: n.name ?? "",
        createdAt: n.createdAt ?? "",
        financialStatus: n.displayFinancialStatus ?? "",
        totalPrice: money(n.currentTotalPriceSet?.shopMoney?.amount),
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

async function fetchShipQueueRest(conn: ShopifyConnection): Promise<ShipQueueOrder[] | null> {
  const res = await shopifyGet<{
    orders?: {
      name?: string;
      created_at?: string;
      cancelled_at?: string | null;
      financial_status?: string;
      total_price?: string;
      line_items?: { title?: string; quantity?: number }[];
    }[];
  }>(
    conn.shop_domain,
    conn.access_token,
    "orders.json?status=open&fulfillment_status=unshipped&limit=50&fields=name,created_at,cancelled_at,financial_status,total_price,line_items",
  );
  if (!res?.orders) return null;
  return res.orders
    .filter((o) => !o.cancelled_at)
    .map((o) => ({
      name: o.name ?? "",
      createdAt: o.created_at ?? "",
      financialStatus: (o.financial_status ?? "").toUpperCase(),
      totalPrice: parseFloat(o.total_price ?? "0") || 0,
      items: (o.line_items ?? []).map((li) => ({
        title: (li.title ?? "").trim() || "(untitled)",
        qty: li.quantity ?? 0,
      })),
    }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Open orders waiting to ship, oldest first (capped at 50). Null = both APIs failed. */
export async function fetchShipQueue(conn: ShopifyConnection): Promise<ShipQueueOrder[] | null> {
  return (await fetchShipQueueGraphql(conn)) ?? (await fetchShipQueueRest(conn));
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
