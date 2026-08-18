/**
 * Operations Center engine — shared by the edge handler and dev-api.ts.
 *
 * One GET returns a live snapshot of what needs the owner's attention right
 * now: today's pulse (orders, revenue, abandoned carts), the ship queue
 * (open unfulfilled orders, oldest first), and the inventory watch (sold-out
 * and low-stock products). Pure Shopify reads — no PII, no LLM, no storage;
 * the panel polls this while open, which is what makes it "live".
 */
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, type ShopifyEnv } from "./_shopify";
import {
  fetchAbandonedCheckoutsWindow,
  fetchInventoryWatch,
  fetchOrdersWindow,
  fetchShipQueue,
  fetchShopCurrency,
} from "./_shopifyData";

function jsonResult(status: number, body: Record<string, unknown>) {
  return { status, body };
}

export async function runOpsSnapshot(
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });
  if (!(await isOperator(env, user.id, user.email))) return { ...OPERATOR_REQUIRED };

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  const [inventory, shipQueue, todayOrders, todayCheckouts, currency] = await Promise.all([
    fetchInventoryWatch(conn),
    fetchShipQueue(conn),
    fetchOrdersWindow(conn, 1),
    fetchAbandonedCheckoutsWindow(conn, 1),
    fetchShopCurrency(conn),
  ]);
  if (!inventory && !shipQueue && !todayOrders) {
    return jsonResult(502, { error: "Couldn't reach the Shopify API." });
  }

  const soldOut = (inventory ?? []).filter((p) => p.soldOut);
  const lowStock = (inventory ?? []).filter((p) => p.lowStock);

  return jsonResult(200, {
    asOf: new Date().toISOString(),
    currency,
    today: {
      orders: todayOrders?.length ?? 0,
      revenue: Math.round((todayOrders ?? []).reduce((n, o) => n + o.totalPrice, 0) * 100) / 100,
      abandoned: todayCheckouts?.length ?? 0,
      unavailable: todayOrders === null,
    },
    shipQueue: shipQueue ?? [],
    shipQueueUnavailable: shipQueue === null,
    inventory: {
      soldOut,
      lowStock,
      checked: (inventory ?? []).length,
      unavailable: inventory === null,
    },
  });
}
