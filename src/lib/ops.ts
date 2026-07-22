/**
 * Client side of the Operations Center. One authed GET returns the live
 * snapshot; the panel re-fetches it on an interval while open. Non-PII.
 */
import { bearer, formatMoney } from "./recovery";

export { formatMoney };

export interface ShipQueueOrder {
  name: string;
  createdAt: string;
  financialStatus: string;
  totalPrice: number;
  items: { title: string; qty: number }[];
}

export interface InventoryProduct {
  title: string;
  totalInventory: number;
  soldOut: boolean;
  lowStock: boolean;
  variants: { title: string; qty: number; tracked: boolean }[];
}

export interface OpsSnapshot {
  asOf: string;
  currency: string | null;
  today: { orders: number; revenue: number; abandoned: number; unavailable?: boolean };
  shipQueue: ShipQueueOrder[];
  shipQueueUnavailable?: boolean;
  inventory: {
    soldOut: InventoryProduct[];
    lowStock: InventoryProduct[];
    checked: number;
    unavailable?: boolean;
  };
}

export class OpsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const token = await bearer();
  if (!token) throw new OpsError(401, "Sign in first.");
  const res = await fetch("/api/ops-snapshot", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as OpsSnapshot & { error?: string };
  if (!res.ok) throw new OpsError(res.status, body.error ?? `Failed (${res.status}).`);
  return body;
}
