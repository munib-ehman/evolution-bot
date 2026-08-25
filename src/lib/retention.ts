/**
 * Client side of the Retention Center.
 *
 * Lapsed customers + recent buyers (with customer detail) come from
 * /api/retention-customers — a PII path like /api/recovery-carts, owner's
 * browser only. The email templates (2 win-back + 1 review request) come from
 * /api/retention-draft (LLM or built-in defaults) and the owner's edits —
 * including their review-page link — persist in the retention_sequences
 * table (owner-scoped RLS). Personalization happens HERE, in code — the
 * model never sees a customer name or email.
 */
import { supabase } from "./auth";
import { bearer, formatMoney, mailtoHref } from "./recovery";

export { formatMoney, mailtoHref };

export interface RetentionTouch {
  delayLabel: string;
  subject: string;
  body: string;
}

export interface LapsedCustomer {
  id: string;
  firstName: string;
  email: string;
  lastOrderAt: string;
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
  fulfilledAt: string;
  totalPrice: number;
  items: { title: string; qty: number }[];
}

export interface RetentionData {
  lapsedWindow: { minDays: number; maxDays: number };
  buyerWindow: { minDays: number; maxDays: number };
  currency: string | null;
  lapsed: LapsedCustomer[];
  buyers: RecentBuyer[];
  noEmailCounts: { lapsed: number; buyers: number };
  lapsedUnavailable?: boolean;
  buyersUnavailable?: boolean;
}

export interface RetentionTemplates {
  winback: RetentionTouch[];
  review: RetentionTouch[];
  /** Owner's review destination (Judge.me, Google…); blank → store URL. */
  reviewLink: string;
}

export class RetentionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getRetentionCustomers(): Promise<RetentionData> {
  const token = await bearer();
  if (!token) throw new RetentionError(401, "Sign in first.");
  const res = await fetch("/api/retention-customers", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as RetentionData & { error?: string };
  if (!res.ok) throw new RetentionError(res.status, body.error ?? `Failed (${res.status}).`);
  return body;
}

export async function generateTemplates(
  note?: string,
): Promise<{ winback: RetentionTouch[]; review: RetentionTouch[] }> {
  const token = await bearer();
  if (!token) throw new RetentionError(401, "Sign in first.");
  const res = await fetch("/api/retention-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ note }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    templates?: { winback: RetentionTouch[]; review: RetentionTouch[] };
    error?: string;
  };
  if (!res.ok || !body.templates) {
    throw new RetentionError(res.status, body.error ?? "Couldn't draft the emails.");
  }
  return body.templates;
}

/** The owner's saved (edited) templates, or null if none yet. */
export async function loadTemplates(): Promise<RetentionTemplates | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("retention_sequences").select("templates").maybeSingle();
    const t = data?.templates as Partial<RetentionTemplates> | undefined;
    if (!t || !Array.isArray(t.winback) || t.winback.length !== 2) return null;
    if (!Array.isArray(t.review) || t.review.length !== 1) return null;
    return {
      winback: t.winback,
      review: t.review,
      reviewLink: typeof t.reviewLink === "string" ? t.reviewLink : "",
    };
  } catch {
    return null;
  }
}

export async function saveTemplates(templates: RetentionTemplates): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;
    await supabase
      .from("retention_sequences")
      .upsert(
        { user_id: user.id, templates, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
  } catch {
    /* best-effort — edits also live in component state */
  }
}

function itemsLabel(items: { title: string; qty: number }[], fallback: string): string {
  return items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title)).join(", ") || fallback;
}

/** Substitute the placeholders for one customer — pure code, no model. */
function substitute(
  touch: RetentionTouch,
  vars: Record<string, string>,
): { subject: string; body: string } {
  const sub = (s: string) =>
    Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(key, value), s);
  return { subject: sub(touch.subject), body: sub(touch.body) };
}

export function renderWinback(
  touch: RetentionTouch,
  customer: LapsedCustomer,
  storeName: string,
  storeUrl: string,
): { subject: string; body: string } {
  return substitute(touch, {
    "{{first_name}}": customer.firstName || "there",
    "{{items}}": itemsLabel(customer.lastItems, "your last order"),
    "{{store_name}}": storeName,
    "{{store_url}}": storeUrl,
    "{{review_link}}": storeUrl,
  });
}

export function renderReview(
  touch: RetentionTouch,
  buyer: RecentBuyer,
  storeName: string,
  storeUrl: string,
  reviewLink: string,
): { subject: string; body: string } {
  return substitute(touch, {
    "{{first_name}}": buyer.firstName || "there",
    "{{items}}": itemsLabel(buyer.items, "your order"),
    "{{store_name}}": storeName,
    "{{store_url}}": storeUrl,
    "{{review_link}}": reviewLink.trim() || storeUrl,
  });
}
