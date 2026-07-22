/**
 * Retention Center engines — shared by the edge handlers and dev-api.ts.
 *
 * Advisory v1, same contract as the Cart Recovery Center: Evolution prepares
 * everything, the OWNER sends from their own inbox. Two engines:
 *   runRetentionCustomers — lapsed customers (win-back) + recent buyers
 *                           (review requests) with customer detail. PII path:
 *                           Shopify → server → owner's browser; never LLM.
 *   runRetentionDraft     — email TEMPLATES (2 win-back touches + 1 review
 *                           request) written by the LLM from NON-PII store
 *                           facts (counts, sums, top titles only), with
 *                           placeholders the client substitutes per customer
 *                           in code. Hand-written defaults ship as fallback.
 *
 * Distinct from the `retention` chat SKILL in _skills.ts (the avatar's
 * advisory snapshot) — no code shared; keep the names apart.
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT } from "./_shared";
import { resolveUserFull } from "./_audit";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { fetchLapsedCustomers, fetchRecentBuyers, fetchShopCurrency } from "./_shopifyData";
import { protectedDataResult } from "./_recovery";
import { buildProductsDigest } from "./_skillTools";

const LAPSED_MIN_DAYS = 60;
const LAPSED_MAX_DAYS = 365;
const BUYER_MIN_DAYS = 7;
const BUYER_MAX_DAYS = 30;

export interface RetentionTouch {
  delayLabel: string;
  subject: string;
  body: string;
}

export interface RetentionTemplates {
  winback: RetentionTouch[];
  review: RetentionTouch[];
}

/** Placeholders the client substitutes per customer — code, not the model. */
export const RETENTION_PLACEHOLDERS = [
  "{{first_name}}",
  "{{items}}",
  "{{store_name}}",
  "{{store_url}}",
  "{{review_link}}",
] as const;

export const DEFAULT_TEMPLATES: RetentionTemplates = {
  winback: [
    {
      delayLabel: "first note",
      subject: "It's been a while, {{first_name}} — everything okay?",
      body:
        "Hi {{first_name}},\n\n" +
        "It's been a couple of months since you picked up {{items}}, and I wanted to check in — how did everything work out?\n\n" +
        "If you've been meaning to come back, we're right where you left us: {{store_url}}\n\n" +
        "And if something wasn't right last time, tell me — I read every reply and I'll make it right.\n\n" +
        "— {{store_name}}",
    },
    {
      delayLabel: "~10 days later, if no reply",
      subject: "One more hello from {{store_name}}",
      body:
        "Hi {{first_name}},\n\n" +
        "Just one more note, then I'll leave you be. We've added new things since your last order, and I think you'd like what you'd find: {{store_url}}\n\n" +
        "No pressure at all — if now's not the time, we'll be here when it is.\n\n" +
        "Thanks for having been a customer. To a small shop like ours, that genuinely matters.\n\n" +
        "— {{store_name}}",
    },
  ],
  review: [
    {
      delayLabel: "once the order has arrived",
      subject: "{{first_name}}, how did we do?",
      body:
        "Hi {{first_name}},\n\n" +
        "Your {{items}} should have arrived by now — I hope it's treating you well!\n\n" +
        "If you have two minutes, an honest review would mean the world to a small shop like ours. It's the single biggest way you can help: {{review_link}}\n\n" +
        "And if anything's not right, just reply to this email and I'll fix it personally.\n\n" +
        "— {{store_name}}",
    },
  ],
};

function jsonResult(status: number, body: Record<string, unknown>) {
  return { status, body };
}

// ---------------------------------------------------------------------------
// GET /api/retention-customers

export async function runRetentionCustomers(
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  const [lapsed, buyers, currency] = await Promise.all([
    fetchLapsedCustomers(conn, { minDays: LAPSED_MIN_DAYS, maxDays: LAPSED_MAX_DAYS }),
    fetchRecentBuyers(conn, { minDays: BUYER_MIN_DAYS, maxDays: BUYER_MAX_DAYS }),
    fetchShopCurrency(conn),
  ]);
  if (lapsed === "access-denied" || buyers === "access-denied") return protectedDataResult();
  if (!lapsed && !buyers) {
    return jsonResult(502, { error: "Couldn't reach the Shopify customers API." });
  }

  const lapsedWithEmail = (lapsed ?? []).filter((c) => c.email.includes("@"));
  const buyersWithEmail = (buyers ?? []).filter((b) => b.email.includes("@"));
  return jsonResult(200, {
    lapsedWindow: { minDays: LAPSED_MIN_DAYS, maxDays: LAPSED_MAX_DAYS },
    buyerWindow: { minDays: BUYER_MIN_DAYS, maxDays: BUYER_MAX_DAYS },
    currency,
    lapsed: lapsedWithEmail,
    buyers: buyersWithEmail,
    noEmailCounts: {
      lapsed: (lapsed ?? []).length - lapsedWithEmail.length,
      buyers: (buyers ?? []).length - buyersWithEmail.length,
    },
    lapsedUnavailable: lapsed === null,
    buyersUnavailable: buyers === null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/retention-draft

interface DraftBody {
  note?: unknown;
}

function validTouch(raw: unknown, fallbackLabel: string, requiredPlaceholder: string): RetentionTouch | null {
  const t = raw as { delayLabel?: unknown; subject?: unknown; body?: unknown };
  if (typeof t?.subject !== "string" || typeof t?.body !== "string") return null;
  const subject = t.subject.trim();
  const body = t.body.trim();
  if (!subject || subject.length > 90) return null;
  if (!body.includes(requiredPlaceholder) || body.length > 1100) return null;
  return {
    delayLabel:
      typeof t.delayLabel === "string" && t.delayLabel.trim() ? t.delayLabel.trim() : fallbackLabel,
    subject,
    body,
  };
}

function validTemplates(raw: unknown): RetentionTemplates | null {
  const r = raw as { winback?: unknown; review?: unknown };
  if (!Array.isArray(r?.winback) || r.winback.length !== 2) return null;
  if (!Array.isArray(r?.review) || r.review.length !== 1) return null;
  const winback: RetentionTouch[] = [];
  for (let i = 0; i < 2; i++) {
    const t = validTouch(r.winback[i], DEFAULT_TEMPLATES.winback[i].delayLabel, "{{store_url}}");
    if (!t) return null;
    winback.push(t);
  }
  const review = validTouch(r.review[0], DEFAULT_TEMPLATES.review[0].delayLabel, "{{review_link}}");
  if (!review) return null;
  return { winback, review: [review] };
}

export async function runRetentionDraft(
  body: DraftBody,
  authHeader: string | null,
  env: ShopifyEnv,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResult(401, { error: "Sign in first." });

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResult(409, { error: "Connect your Shopify store first." });

  const note = typeof body.note === "string" ? body.note.slice(0, 500).trim() : "";
  const shop = conn.shop_domain.replace(".myshopify.com", "");

  if (!env.groqKey) {
    return jsonResult(200, { templates: DEFAULT_TEMPLATES, source: "default" });
  }

  // NON-PII store facts only. The PII fetchers run here, but nothing beyond
  // counts and a rounded spend sum may reach the prompt.
  const [digest, lapsed, buyers] = await Promise.all([
    buildProductsDigest(conn, 50),
    fetchLapsedCustomers(conn, { minDays: LAPSED_MIN_DAYS, maxDays: LAPSED_MAX_DAYS }),
    fetchRecentBuyers(conn, { minDays: BUYER_MIN_DAYS, maxDays: BUYER_MAX_DAYS }),
  ]);
  const topTitles =
    "error" in digest
      ? []
      : (digest.products as { title: string }[]).slice(0, 5).map((p) => p.title);
  const lapsedRows = Array.isArray(lapsed) ? lapsed : [];
  const buyerCount = Array.isArray(buyers) ? buyers.length : 0;
  const lapsedValue = Math.round(lapsedRows.reduce((n, c) => n + c.totalSpent, 0));

  const system = [
    `You write customer-retention emails for the Shopify store "${shop}". Write TWO win-back emails for customers who haven't bought in 2+ months, and ONE review-request email for recent buyers.`,
    `Rules: plain text only (no HTML, no markdown). Each body under 700 characters, warm and founder-to-customer, never pushy, never guilt-tripping. Personalize ONLY with these exact placeholders: {{first_name}}, {{items}}, {{store_name}}, {{store_url}}, {{review_link}}. Both win-back bodies MUST contain {{store_url}}. The review body MUST contain {{review_link}}. Subjects under 70 characters. Win-back touch 2 is a respectful last note. Invite replies — the owner reads them.`,
    `Respond with ONLY a JSON object: {"winback":[{"delayLabel":"...","subject":"...","body":"..."},{...}],"review":[{"delayLabel":"...","subject":"...","body":"..."}]}.`,
  ].join("\n\n");
  const userMsg =
    `Store facts: top products ${JSON.stringify(topTitles)}; ${lapsedRows.length} lapsed customers (no order in ${LAPSED_MIN_DAYS}–${LAPSED_MAX_DAYS} days) worth ~${lapsedValue} lifetime; ${buyerCount} recent buyers to ask for reviews.` +
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
        max_tokens: 1400,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as unknown;
      const templates = validTemplates(parsed);
      if (templates) return jsonResult(200, { templates, source: "ai" });
    }
  } catch {
    /* fall through to defaults */
  }
  return jsonResult(200, { templates: DEFAULT_TEMPLATES, source: "default" });
}
