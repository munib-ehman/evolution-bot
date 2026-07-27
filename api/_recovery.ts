/**
 * Cart Recovery Center engines — shared by the edge handlers and dev-api.ts.
 *
 * Advisory v1: Evolution prepares everything, the OWNER sends from their own
 * inbox. Two engines:
 *   runRecoveryCarts  — the recoverable carts with customer detail (the one
 *                       PII path in the app: Shopify → server → owner's
 *                       browser; never into LLM context).
 *   runRecoveryDraft  — a 3-touch email TEMPLATE sequence written by the LLM
 *                       from NON-PII store facts, with placeholders the
 *                       client substitutes per customer in code. Hand-written
 *                       defaults ship as fallback so the feature never
 *                       dead-ends on a missing key or a flaky model.
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT } from "./_shared";
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, type ShopifyEnv } from "./_shopify";
import {
  fetchAbandonedCheckoutsWindow,
  fetchRecoverableCheckouts,
  fetchShopCurrency,
} from "./_shopifyData";
import { buildProductsDigest } from "./_skillTools";

const WINDOW_DAYS = 30;

export interface RecoveryTouch {
  delayLabel: string;
  subject: string;
  body: string;
}

/** Placeholders the client substitutes per customer — code, not the model. */
export const RECOVERY_PLACEHOLDERS = [
  "{{first_name}}",
  "{{items}}",
  "{{total}}",
  "{{checkout_url}}",
  "{{store_name}}",
] as const;

export const DEFAULT_TOUCHES: RecoveryTouch[] = [
  {
    delayLabel: "~1 hour after abandonment",
    subject: "You left something behind at {{store_name}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Looks like you got interrupted — your cart with {{items}} is saved and waiting.\n\n" +
      "Pick up right where you left off: {{checkout_url}}\n\n" +
      "If anything held you back — a question, shipping, sizing — just reply to this email and I'll help.\n\n" +
      "— {{store_name}}",
  },
  {
    delayLabel: "day 2",
    subject: "Still thinking it over? Your {{store_name}} cart is saved",
    body:
      "Hi {{first_name}},\n\n" +
      "Your cart ({{items}} — {{total}}) is still saved. No rush, but popular items do sell out.\n\n" +
      "Finish checkout here: {{checkout_url}}\n\n" +
      "Questions? Just hit reply — a real person reads these.\n\n" +
      "— {{store_name}}",
  },
  {
    delayLabel: "day 4 (last touch)",
    subject: "Last call on your cart, {{first_name}}",
    body:
      "Hi {{first_name}},\n\n" +
      "This is the last note about your saved cart with {{items}}. After this we'll leave you be!\n\n" +
      "If you still want it, it's one click away: {{checkout_url}}\n\n" +
      "Either way — thanks for considering {{store_name}}.\n\n" +
      "— {{store_name}}",
  },
];

function jsonResult(status: number, body: Record<string, unknown>) {
  return { status, body };
}

/**
 * Shopify refused customer PII outright — the app is missing protected-
 * customer-data access (a Partner Dashboard toggle, separate from OAuth
 * scopes). Without this message the failure looks like an outage.
 */
export const PROTECTED_DATA_MESSAGE =
  "Shopify hasn't granted this app access to customer data yet. In your Shopify Partner Dashboard, " +
  "open your app → API access → Protected customer data access, select \"Protected customer data\" " +
  "plus the Name and Email fields (reason: app functionality), and save. Access is immediate on " +
  "development stores.";

export function protectedDataResult() {
  return jsonResult(403, { error: PROTECTED_DATA_MESSAGE, needsProtectedData: true });
}

// ---------------------------------------------------------------------------
// GET /api/recovery-carts

export async function runRecoveryCarts(
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });
  if (!(await isOperator(env, user.id))) return { ...OPERATOR_REQUIRED };

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  const [carts, currency] = await Promise.all([
    fetchRecoverableCheckouts(conn, WINDOW_DAYS),
    fetchShopCurrency(conn),
  ]);
  if (carts === "access-denied") return protectedDataResult();
  if (!carts) return jsonResult(502, { error: "Couldn't reach the Shopify checkouts API." });

  const withEmail = carts.filter((c) => c.email.includes("@") && c.recoveryUrl);
  const noEmailCount = carts.length - withEmail.length;
  return jsonResult(200, {
    windowDays: WINDOW_DAYS,
    currency,
    carts: withEmail,
    noEmailCount,
  });
}

// ---------------------------------------------------------------------------
// POST /api/recovery-draft

interface DraftBody {
  note?: unknown;
}

function validTouches(raw: unknown): RecoveryTouch[] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const touches: RecoveryTouch[] = [];
  for (let i = 0; i < 3; i++) {
    const t = raw[i] as { delayLabel?: unknown; subject?: unknown; body?: unknown };
    if (typeof t?.subject !== "string" || typeof t?.body !== "string") return null;
    const subject = t.subject.trim();
    const body = t.body.trim();
    if (!subject || subject.length > 90) return null;
    if (!body.includes("{{checkout_url}}") || body.length > 1100) return null;
    touches.push({
      delayLabel:
        typeof t.delayLabel === "string" && t.delayLabel.trim()
          ? t.delayLabel.trim()
          : DEFAULT_TOUCHES[i].delayLabel,
      subject,
      body,
    });
  }
  return touches;
}

export async function runRecoveryDraft(
  body: DraftBody,
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });
  if (!(await isOperator(env, user.id))) return { ...OPERATOR_REQUIRED };

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  const note = typeof body.note === "string" ? body.note.slice(0, 500).trim() : "";
  const shop = conn.shop_domain.replace(".myshopify.com", "");

  if (!env.groqKey) {
    return jsonResult(200, { touches: DEFAULT_TOUCHES, source: "default" });
  }

  // NON-PII store facts only — catalog aggregate + abandoned totals.
  const [digest, checkouts] = await Promise.all([
    buildProductsDigest(conn, 50),
    fetchAbandonedCheckoutsWindow(conn, WINDOW_DAYS),
  ]);
  const topTitles =
    "error" in digest
      ? []
      : (digest.products as { title: string }[]).slice(0, 5).map((p) => p.title);
  const abandonedCount = checkouts?.length ?? 0;
  const abandonedValue = Math.round(checkouts?.reduce((n, c) => n + c.totalPrice, 0) ?? 0);

  const system = [
    `You write abandoned-cart recovery emails for the Shopify store "${shop}". Write a 3-touch sequence.`,
    `Rules: plain text only (no HTML, no markdown). Each body under 700 characters, warm and founder-to-customer, never pushy. Personalize ONLY with these exact placeholders: {{first_name}}, {{items}}, {{total}}, {{checkout_url}}, {{store_name}}. Every body MUST contain {{checkout_url}}. Subjects under 70 characters. Touch 1 = helpful reminder (~1 hour), touch 2 = gentle nudge with the saved cart (day 2), touch 3 = respectful last call (day 4). Invite replies — the owner reads them.`,
    `Respond with ONLY a JSON object: {"touches":[{"delayLabel":"...","subject":"...","body":"..."},...]} — exactly 3 touches.`,
  ].join("\n\n");
  const userMsg =
    `Store facts: top products ${JSON.stringify(topTitles)}; ${abandonedCount} abandoned checkouts worth ~${abandonedValue} in the last ${WINDOW_DAYS} days.` +
    (note ? ` Owner's tone/notes: ${JSON.stringify(note)}` : "");

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
      body: JSON.stringify({
        model: env.groqModel || CHAT_MODEL_DEFAULT,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: 0.6,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
        touches?: unknown;
      };
      const touches = validTouches(parsed.touches);
      if (touches) return jsonResult(200, { touches, source: "ai" });
    }
  } catch {
    /* fall through to defaults */
  }
  return jsonResult(200, { touches: DEFAULT_TOUCHES, source: "default" });
}
