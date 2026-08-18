/**
 * Shared store-data fetchers — GraphQL Admin API only.
 *
 * The REST Admin API is legacy: Shopify blocks its endpoints for newly
 * created apps and App Store review requires public apps to be built
 * exclusively on GraphQL, so there are no REST fallbacks here. Callers get
 * one normalized shape; null means the read failed (callers degrade, they
 * don't crash).
 */
import {
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

/** Orders in the last N days (capped at 250, newest first). Null = read failed. */
export async function fetchOrdersWindow(
  conn: ShopifyConnection,
  days: number,
  opts: { lineItems?: boolean } = {},
): Promise<OrderRow[] | null> {
  return fetchOrdersGraphql(conn, days, opts.lineItems ?? false);
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

/** Abandoned checkouts in the last N days (capped at 250). Null = read failed. */
export async function fetchAbandonedCheckoutsWindow(
  conn: ShopifyConnection,
  days: number,
): Promise<CheckoutRow[] | null> {
  return fetchCheckoutsGraphql(conn, days);
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

/** Abandoned carts with customer + recovery detail (PII — owner's eyes only). */
export async function fetchRecoverableCheckouts(
  conn: ShopifyConnection,
  days: number,
): Promise<PiiResult<RecoverableCart>> {
  return fetchRecoveryGraphql(conn, days);
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
  /** Lifetime order count. */
  ordersCount: number;
  totalSpent: number;
  lastItems: { title: string; qty: number }[];
  marketingState?: string | null;
}

export interface RecentBuyer {
  orderId: string;
  customerId: string | null;
  firstName: string;
  email: string;
  orderedAt: string;
  /** Successful fulfillment timestamp used for review-request eligibility. */
  fulfilledAt: string;
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
      emailMarketingConsent { marketingState }
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
      emailMarketingConsent?: { marketingState?: string | null } | null;
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
  includeNeverOrdered = false,
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
      if (!lastAt && !includeNeverOrdered) continue;
      if (lastAt) {
        const age = daysAgo(lastAt);
        if (!Number.isFinite(age) || age < minDays || age > maxDays) continue;
      }
      out.push({
        id: n.id ?? "",
        firstName: (n.firstName ?? "").trim(),
        email: (n.defaultEmailAddress?.emailAddress ?? "").trim(),
        lastOrderAt: lastAt ?? "",
        ordersCount: Number(n.numberOfOrders) || 0,
        totalSpent: money(n.amountSpent?.amount),
        lastItems: (n.lastOrder?.lineItems?.nodes ?? []).map((li) => ({
          title: (li.title ?? "").trim() || "(untitled)",
          qty: li.quantity ?? 0,
        })),
        marketingState: n.emailMarketingConsent?.marketingState ?? null,
      });
      if (out.length >= LAPSED_COLLECT_CAP) break;
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

/** Past customers available for marketing segmentation. Callers must enforce SUBSCRIBED. */
export async function fetchMarketingCustomers(conn: ShopifyConnection): Promise<PiiResult<LapsedCustomer>> {
  const rows = await fetchLapsedGraphql(conn, 0, 3650, true);
  if (rows === "access-denied" || rows === null) return rows;
  return rows.sort((a, b) => Date.parse(b.lastOrderAt) - Date.parse(a.lastOrderAt));
}

/** Customers whose last order fell out of the window (PII — owner's eyes only). */
export async function fetchLapsedCustomers(
  conn: ShopifyConnection,
  opts: { minDays: number; maxDays: number },
): Promise<PiiResult<LapsedCustomer>> {
  const rows = await fetchLapsedGraphql(conn, opts.minDays, opts.maxDays);
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
      displayFulfillmentStatus
      email
      customer { id firstName }
      currentTotalPriceSet { shopMoney { amount } }
      fulfillments(first: 10) { createdAt status }
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
      displayFulfillmentStatus?: string | null;
      email?: string | null;
      customer?: { id?: string; firstName?: string | null } | null;
      currentTotalPriceSet?: { shopMoney?: { amount?: string } } | null;
      fulfillments?: { createdAt?: string; status?: string | null }[];
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
    }[];
  };
}

const REFUNDED_STATUSES = new Set(["REFUNDED", "VOIDED", "refunded", "voided"]);

export function reviewEligibleFulfillment(
  order: { cancelledAt?: string | null; financialStatus?: string | null; fulfillmentStatus?: string | null; fulfillments?: { createdAt?: string; status?: string | null }[] },
  minDays: number,
  maxDays: number,
  now = Date.now(),
): string | null {
  if (order.cancelledAt || REFUNDED_STATUSES.has(order.financialStatus ?? "")) return null;
  if ((order.fulfillmentStatus ?? "").toUpperCase() !== "FULFILLED") return null;
  const successful = (order.fulfillments ?? [])
    .filter((fulfillment) => (fulfillment.status ?? "").toUpperCase() === "SUCCESS" && fulfillment.createdAt)
    .map((fulfillment) => fulfillment.createdAt as string)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const fulfilledAt = successful[0];
  if (!fulfilledAt) return null;
  const age = (now - Date.parse(fulfilledAt)) / 86_400_000;
  return Number.isFinite(age) && age >= minDays && age <= maxDays ? fulfilledAt : null;
}

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
      const fulfilledAt = reviewEligibleFulfillment({
        cancelledAt: n.cancelledAt,
        financialStatus: n.displayFinancialStatus,
        fulfillmentStatus: n.displayFulfillmentStatus,
        fulfillments: n.fulfillments,
      }, minDays, maxDays);
      if (!fulfilledAt) continue;
      out.push({
        orderId: n.id ?? "",
        customerId: n.customer?.id ?? null,
        firstName: (n.customer?.firstName ?? "").trim(),
        email: (n.email ?? "").trim(),
        orderedAt: n.createdAt ?? "",
        fulfilledAt,
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

/**
 * Buyers whose order is old enough to have arrived but recent enough to
 * review — one row per customer, latest order wins (PII — owner's eyes only).
 */
export async function fetchRecentBuyers(
  conn: ShopifyConnection,
  opts: { minDays: number; maxDays: number },
): Promise<PiiResult<RecentBuyer>> {
  return fetchBuyersGraphql(conn, opts.minDays, opts.maxDays);
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

export interface SupportRiskOrder extends ShipQueueOrder {
  id: string;
  firstName: string;
  email: string;
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

/** Active products with stock classification (capped at 100). Null = read failed. */
export async function fetchInventoryWatch(conn: ShopifyConnection): Promise<InventoryProduct[] | null> {
  return fetchInventoryGraphql(conn);
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

/** Open orders waiting to ship, oldest first (capped at 50). Null = read failed. */
export async function fetchShipQueue(conn: ShopifyConnection): Promise<ShipQueueOrder[] | null> {
  return fetchShipQueueGraphql(conn);
}

const SUPPORT_RISKS_QUERY = `query SupportRisks($first: Int!, $after: String) {
  orders(first: $first, after: $after, query: "fulfillment_status:unshipped", sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFinancialStatus email
      customer { firstName defaultEmailAddress { emailAddress } }
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { title quantity } }
    }
  }
}`;

interface GqlSupportRisksData {
  orders?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string; name?: string; createdAt?: string; cancelledAt?: string | null;
      displayFinancialStatus?: string | null; email?: string | null;
      customer?: { firstName?: string | null; defaultEmailAddress?: { emailAddress?: string | null } | null } | null;
      currentTotalPriceSet?: { shopMoney?: { amount?: string } } | null;
      lineItems?: { nodes?: { title?: string; quantity?: number }[] };
    }[];
  };
}

/** Owner-only support queue with contact details. Never expose this through LLM tools. */
export async function fetchSupportRiskOrders(conn: ShopifyConnection): Promise<PiiResult<SupportRiskOrder>> {
  const out: SupportRiskOrder[] = [];
  let after: string | null = null;
  while (out.length < SHIP_QUEUE_CAP) {
    const { data, accessDenied }: { data: GqlSupportRisksData | null; accessDenied: boolean } = await shopifyGraphqlDetailed<GqlSupportRisksData>(conn.shop_domain, conn.access_token, SUPPORT_RISKS_QUERY, {
      first: Math.min(25, SHIP_QUEUE_CAP - out.length), after,
    });
    if (accessDenied) return "access-denied";
    const page: GqlSupportRisksData["orders"] = data?.orders;
    if (!page?.nodes) return out.length ? out : null;
    for (const order of page.nodes) {
      if (order.cancelledAt) continue;
      out.push({
        id: order.id ?? "", name: order.name ?? "", createdAt: order.createdAt ?? "",
        financialStatus: order.displayFinancialStatus ?? "", totalPrice: money(order.currentTotalPriceSet?.shopMoney?.amount),
        firstName: (order.customer?.firstName ?? "").trim(),
        // Shopify may keep the confirmed address on the customer while the
        // legacy order-level email field is blank. Prefer the order address,
        // then fall back to the linked customer's current default address.
        email: (order.email ?? order.customer?.defaultEmailAddress?.emailAddress ?? "").trim(),
        items: (order.lineItems?.nodes ?? []).map((item: { title?: string; quantity?: number }) => ({ title: (item.title ?? "").trim() || "(untitled)", qty: item.quantity ?? 0 })),
      });
    }
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shop info

/** The store's currency code, or null if the read failed. */
export async function fetchShopCurrency(conn: ShopifyConnection): Promise<string | null> {
  const data = await shopifyGraphql<{ shop?: { currencyCode?: string } }>(
    conn.shop_domain,
    conn.access_token,
    "query ShopCurrency { shop { currencyCode } }",
    {},
  );
  return data?.shop?.currencyCode ?? null;
}

const UNSUBSCRIBE_EMAIL_MARKETING_MUTATION = `mutation UnsubscribeEmailMarketing($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

/** Mirror an Evolution email opt-out into the Shopify customer record. */
export async function unsubscribeCustomerEmailMarketing(
  conn: ShopifyConnection,
  customerId: string,
  consentUpdatedAt = new Date().toISOString(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customerId.startsWith("gid://shopify/Customer/")) {
    return { ok: false, error: "Invalid Shopify customer ID." };
  }
  const data = await shopifyGraphql<{
    customerEmailMarketingConsentUpdate?: {
      customer?: { id?: string } | null;
      userErrors?: { message?: string }[];
    };
  }>(conn.shop_domain, conn.access_token, UNSUBSCRIBE_EMAIL_MARKETING_MUTATION, {
    input: {
      customerId,
      emailMarketingConsent: { marketingState: "UNSUBSCRIBED", consentUpdatedAt },
    },
  });
  const payload = data?.customerEmailMarketingConsentUpdate;
  const message = payload?.userErrors?.map((item) => item.message).filter(Boolean).join("; ");
  if (!payload?.customer?.id || message) {
    return { ok: false, error: message || "Shopify did not update marketing consent." };
  }
  return { ok: true };
}
