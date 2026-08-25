/**
 * Client side of the Cart Recovery Center.
 *
 * Carts (with customer detail) come from /api/recovery-carts — the app's one
 * PII path, owner's browser only. The 3-touch sequence template comes from
 * /api/recovery-draft (LLM or built-in defaults) and the owner's edits
 * persist in the recovery_sequences table (owner-scoped RLS, direct
 * supabase-js like `stores`). Personalization happens HERE, in code — the
 * model never sees a customer name or email.
 */
import { supabase } from "./auth";

export interface RecoveryTouch {
  delayLabel: string;
  subject: string;
  body: string;
}

export interface RecoveryCampaignProposal {
  id: string;
  status: "proposed";
  touches: RecoveryTouch[];
  cartCount: number;
  totalValue: number;
  currency: string | null;
  storeName: string;
  deliveryReady: boolean;
  createdAt: string;
}

export interface RecoveryCart {
  id: string;
  createdAt: string;
  totalPrice: number;
  recoveryUrl: string;
  firstName: string;
  email: string;
  items: { title: string; qty: number }[];
}

export interface RecoveryData {
  windowDays: number;
  currency: string | null;
  carts: RecoveryCart[];
  noEmailCount: number;
}

export class RecoveryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function bearer(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getRecoveryCarts(): Promise<RecoveryData> {
  const token = await bearer();
  if (!token) throw new RecoveryError(401, "Sign in first.");
  const res = await fetch("/api/recovery-carts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as RecoveryData & { error?: string };
  if (!res.ok) throw new RecoveryError(res.status, body.error ?? `Failed (${res.status}).`);
  return body;
}

export async function generateSequence(note?: string): Promise<RecoveryTouch[]> {
  const token = await bearer();
  if (!token) throw new RecoveryError(401, "Sign in first.");
  const res = await fetch("/api/recovery-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ note }),
  });
  const body = (await res.json().catch(() => ({}))) as { touches?: RecoveryTouch[]; error?: string };
  if (!res.ok || !body.touches) throw new RecoveryError(res.status, body.error ?? "Couldn't draft the sequence.");
  return body.touches;
}

/** The owner's saved (edited) sequence, or null if none yet. */
export async function loadSequence(): Promise<RecoveryTouch[] | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("recovery_sequences").select("touches").maybeSingle();
    const touches = data?.touches as RecoveryTouch[] | undefined;
    return Array.isArray(touches) && touches.length === 3 ? touches : null;
  } catch {
    return null;
  }
}

export async function saveSequence(touches: RecoveryTouch[]): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;
    await supabase
      .from("recovery_sequences")
      .upsert({ user_id: user.id, touches, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  } catch {
    /* best-effort — edits also live in component state */
  }
}

/** Substitute the placeholders for one customer — pure code, no model. */
export function renderTouch(
  touch: RecoveryTouch,
  cart: RecoveryCart,
  storeName: string,
  currency: string | null,
): { subject: string; body: string } {
  const items = cart.items
    .map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title))
    .join(", ") || "your items";
  const total = formatMoney(cart.totalPrice, currency);
  const firstName = cart.firstName || "there";
  const sub = (s: string) =>
    s
      .replaceAll("{{first_name}}", firstName)
      .replaceAll("{{items}}", items)
      .replaceAll("{{total}}", total)
      .replaceAll("{{checkout_url}}", cart.recoveryUrl)
      .replaceAll("{{store_name}}", storeName);
  return { subject: sub(touch.subject), body: sub(touch.body) };
}

export function formatMoney(n: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

/** mailto: link with the personalized email prefilled (owner's own mail app). */
export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
