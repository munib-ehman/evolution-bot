/**
 * The agentic chat engine — shared by /api/agent-chat (edge) and dev-api.ts.
 *
 * This is the general answer to "the copilot deflects whenever a question
 * needs data we didn't pre-feed": for a signed-in founder with a connected
 * store, the chat model holds the SAME tools the skills use and decides
 * mid-conversation which to call. The founder can ask across any vertical
 * (sales, orders, carts, audit, catalog) without us shipping a context block
 * per question type. The design rule is unchanged: tools compute every
 * number in code; the model orchestrates and narrates.
 *
 * Flow per turn: auth → load compact durable/recent memory → select only the
 * relevant tools → up to MAX_TOOL_ROUNDS Groq calls with
 * tool_choice auto, executing SKILL_TOOLS between rounds → the final answer
 * is emitted through the same SSE protocol the skills use, so the client's
 * parser and the voice pipeline work unchanged:
 *   data: {"progress":"Crunching your sales…"}
 *   data: {"choices":[{"delta":{"content":"…"}}]}
 *   data: {"error":"…"}
 *   data: [DONE]
 */
import {
  GROQ_BASE,
  CHAT_MODEL_DEFAULT,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOTAL_CHARS,
  CHAT_MAX_COMPLETION_TOKENS,
} from "./_shared";
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection } from "./_shopify";
import { SKILL_TOOLS, buildProductsDigest, type SkillEnv, type ToolCtx, type ToolSchema } from "./_skillTools";
import { log } from "./_log";
import { runActionPropose } from "./_actions";
import { runRecoveryCarts, runRecoveryDraft } from "./_recovery";
import { runRetentionCustomers, runRetentionDraft } from "./_retention";
import { runBroadcastAction } from "./_broadcastCampaigns";

/**
 * Tools the chat may call — read-only store data. file_task is deliberately
 * NOT exposed: with no write access anywhere yet, the bot must never promise
 * that a change will be made; it advises instead (re-add when fixes ship).
 */
const AGENT_TOOL_NAMES = [
  "get_products",
  "get_product_detail",
  "get_product_sales",
  "get_orders_summary",
  "get_abandoned_checkouts",
  "get_latest_audit",
  "get_ship_queue",
  "get_inventory_watch",
  "get_retention_snapshot",
  "remember_business_fact",
  "create_recovery_campaign",
  "create_winback_campaign",
  "create_broadcast_campaign",
  "prepare_product_updates",
  "prepare_product_draft",
  "prepare_collection",
  "prepare_discount",
] as const;

const PROPOSAL_SCHEMAS: Record<string, ToolSchema> = {
  remember_business_fact: {
    type: "function",
    function: {
      name: "remember_business_fact",
      description: "Persist a durable merchant business preference or decision that the merchant explicitly stated or explicitly asked you to remember. Never store customer PII, credentials, transient requests, or facts inferred without confirmation.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["brand", "audience", "campaign", "policy", "preference", "business"] },
          content: { type: "string", description: "A concise standalone fact, maximum 500 characters." },
        },
        required: ["category", "content"],
      },
    },
  },
  create_recovery_campaign: {
    type: "function",
    function: {
      name: "create_recovery_campaign",
      description: "Create and persist an approval-ready three-email abandoned-checkout recovery campaign draft. This never sends email and never enables an automation.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "Merchant instructions for tone, timing, incentives, or exclusions. State 'no discount' when requested." },
        },
        required: ["note"],
      },
    },
  },
  create_winback_campaign: {
    type: "function",
    function: {
      name: "create_winback_campaign",
      description: "Create and persist an approval-ready two-email campaign for customers inactive for 60-365 days. This never sends email.",
      parameters: { type: "object", properties: { note: { type: "string", description: "Merchant instructions for tone, offer, timing, or exclusions." } }, required: ["note"] },
    },
  },
  create_broadcast_campaign: {
    type: "function",
    function: {
      name: "create_broadcast_campaign",
      description: "Create and persist an approval-ready one-time email campaign for Shopify customers who are currently subscribed to email marketing. This creates a draft only and never sends or schedules it without merchant approval.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short internal campaign name." },
          segment: { type: "string", enum: ["subscribers", "recent", "repeat", "vip", "lapsed"] },
          subject: { type: "string", description: "Customer-facing email subject, maximum 120 characters." },
          body: { type: "string", description: "Plain-text email copy. May use {{first_name}}, {{store_name}}, and {{store_url}}." },
          scheduledAt: { type: ["string", "null"], description: "Requested future ISO-8601 send time, or null when the merchant has not specified a time." },
        },
        required: ["name", "segment", "subject", "body"],
      },
    },
  },
  prepare_product_updates: {
    type: "function",
    function: {
      name: "prepare_product_updates",
      description: "Prepare, but never execute, a merchant approval card for 1-10 product listing updates. Use only when the founder requests a concrete change.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          items: {
            type: "array", minItems: 1, maxItems: 10,
            items: {
              type: "object",
              properties: {
                productId: { type: "string" }, title: { type: "string" }, descriptionHtml: { type: "string" },
                seoTitle: { type: "string" }, seoDescription: { type: "string" }, tags: { type: "array", items: { type: "string" } }, vendor: { type: "string" }, productType: { type: "string" },
                mediaAlt: { type: "array", items: { type: "object", properties: { id: { type: "string" }, alt: { type: "string" } }, required: ["id", "alt"] } },
              },
              required: ["productId"],
            },
          },
        },
        required: ["summary", "items"],
      },
    },
  },
  prepare_product_draft: {
    type: "function",
    function: {
      name: "prepare_product_draft",
      description: "Prepare an approval card to create an unpublished Shopify draft product. Never publish it.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          product: {
            type: "object",
            properties: {
              title: { type: "string" }, descriptionHtml: { type: "string" }, vendor: { type: "string" },
              productType: { type: "string" }, tags: { type: "array", items: { type: "string" } },
            },
            required: ["title"],
          },
        },
        required: ["summary", "product"],
      },
    },
  },
  prepare_collection: {
    type: "function",
    function: {
      name: "prepare_collection",
      description: "Prepare an approval card to create or update a Shopify collection and selected product membership.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          collection: {
            type: "object",
            properties: {
              id: { type: "string" }, title: { type: "string" }, descriptionHtml: { type: "string" }, handle: { type: "string" },
              sortOrder: { type: "string" }, products: { type: "array", items: { type: "string" } },
              seo: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } } },
            },
            required: ["title"],
          },
        },
        required: ["summary", "collection"],
      },
    },
  },
  prepare_discount: {
    type: "function",
    function: {
      name: "prepare_discount",
      description: "Prepare an approval card for a safe Shopify code or automatic discount. Never execute it.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" }, automatic: { type: "boolean" },
          discount: {
            type: "object",
            properties: {
              title: { type: "string" }, code: { type: "string" }, valueType: { type: "string", enum: ["percentage", "fixed", "free_shipping"] },
              value: { type: "number" }, startsAt: { type: "string" }, endsAt: { type: ["string", "null"] },
              minimumSubtotal: { type: ["number", "null"] }, usageLimit: { type: ["number", "null"] }, appliesOncePerCustomer: { type: "boolean" },
              productIds: { type: "array", items: { type: "string" } },
            },
            required: ["title", "valueType", "startsAt"],
          },
        },
        required: ["summary", "automatic", "discount"],
      },
    },
  },
};

const PROGRESS_LABELS: Record<string, string> = {
  get_products: "Reading your catalog…",
  get_product_sales: "Crunching your sales…",
  get_orders_summary: "Pulling your order stats…",
  get_abandoned_checkouts: "Checking your abandoned carts…",
  get_latest_audit: "Reading your latest audit…",
  get_ship_queue: "Checking what's waiting to ship…",
  get_inventory_watch: "Checking your stock levels…",
  get_retention_snapshot: "Looking through your customers…",
  remember_business_fact: "Saving that to your store memory…",
  create_recovery_campaign: "Creating and saving your recovery draft…",
  create_winback_campaign: "Creating and saving your win-back draft…",
  create_broadcast_campaign: "Creating and saving your one-time campaign draft…",
  prepare_product_updates: "Preparing product changes for your approval…",
  prepare_product_draft: "Preparing an unpublished product draft…",
  prepare_collection: "Preparing the collection change…",
  prepare_discount: "Preparing the promotion for your approval…",
};

/** One tool-selection round plus one answer round. Clear commands bypass both. */
const MAX_TOOL_ROUNDS = 2;
const GROQ_TIMEOUT_MS = 25_000;
/** Client history is advisory; the server enforces its own tighter cap. */
const MAX_HISTORY_TURNS = 6;

export interface AgentChatBody {
  messages?: unknown;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface GroqChatMessage {
  role: string;
  content: string | null;
  tool_calls?: GroqToolCall[];
}

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const sseDone = enc.encode("data: [DONE]\n\n");

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validateTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CHAT_MAX_MESSAGES) return null;
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const m of raw) {
    const msg = m as { role?: unknown; content?: unknown };
    // The system prompt is server-built; client-sent system turns are dropped.
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (typeof msg.content !== "string") return null;
    total += msg.content.length;
    turns.push({ role: msg.role, content: msg.content });
  }
  if (turns.length === 0 || total > CHAT_MAX_TOTAL_CHARS) return null;
  return turns.slice(-MAX_HISTORY_TURNS);
}

const memoryHeaders = (env: SkillEnv): Record<string, string> => {
  const key = env.serviceRoleKey ?? "";
  return { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", "User-Agent": "EvolutionBackend/1.0" };
};

async function loadPersistentContext(env: SkillEnv, userId: string, current: ChatTurn[]): Promise<string> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return "No persistent memory is configured yet.";
  try {
    const headers = memoryHeaders(env);
    const [memoryRes, chatRes] = await Promise.all([
      fetch(`${env.supabaseUrl}/rest/v1/agent_memories?user_id=eq.${encodeURIComponent(userId)}&select=category,content,updated_at&order=updated_at.desc&limit=12`, { headers }),
      fetch(`${env.supabaseUrl}/rest/v1/chat_messages?user_id=eq.${encodeURIComponent(userId)}&select=role,content,created_at&order=created_at.desc&limit=10`, { headers }),
    ]);
    const memories = memoryRes.ok ? await memoryRes.json() as { category: string; content: string }[] : [];
    const recent = chatRes.ok ? await chatRes.json() as { role: string; content: string }[] : [];
    const currentKeys = new Set(current.map((turn) => `${turn.role}:${turn.content}`));
    const previous = recent
      .filter((turn) => (turn.role === "user" || turn.role === "assistant") && !currentKeys.has(`${turn.role}:${turn.content}`))
      .reverse()
      .map((turn) => `${turn.role}: ${turn.content.slice(0, 350)}`)
      .join("\n")
      .slice(-2_400);
    const facts = memories.map((memory) => `- [${memory.category}] ${memory.content.slice(0, 300)}`).join("\n");
    return [
      "DURABLE MERCHANT MEMORY (explicit facts; authoritative until changed):",
      facts || "- No explicit durable facts saved yet.",
      "RECENT PRIOR-CONVERSATION CONTEXT (may be stale; verify live numbers with tools):",
      previous || "- No earlier conversation context available.",
    ].join("\n");
  } catch {
    return "Persistent memory is temporarily unavailable. Do not pretend you remembered prior sessions.";
  }
}

async function rememberBusinessFact(env: SkillEnv, userId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return { error: "Persistent memory is not configured." };
  const allowed = new Set(["brand", "audience", "campaign", "policy", "preference", "business"]);
  const category = typeof args.category === "string" && allowed.has(args.category) ? args.category : "preference";
  const content = typeof args.content === "string" ? args.content.trim().slice(0, 500) : "";
  if (!content) return { error: "Memory content is required." };
  const res = await fetch(`${env.supabaseUrl}/rest/v1/agent_memories?on_conflict=user_id,category,content`, {
    method: "POST",
    headers: { ...memoryHeaders(env), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, category, content, source: "explicit_chat", updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return { error: "I couldn't save that memory right now." };
  return { saved: true, category, content };
}

async function createRecoveryCampaign(
  env: SkillEnv,
  userId: string,
  authHeader: string | null,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const note = typeof args.note === "string" ? args.note.slice(0, 500) : "";
  const draft = await runRecoveryDraft({ note }, authHeader, env);
  if (draft.status !== 200 || !Array.isArray(draft.body.touches)) return draft.body;
  const audience = await runRecoveryCarts(authHeader, env);
  if (audience.status !== 200 || !Array.isArray(audience.body.carts)) return audience.body;
  const carts = audience.body.carts as { totalPrice?: number }[];
  const connection = await getConnection(env, userId);
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { error: "The campaign was generated but persistent campaign storage is not configured." };
  }
  const saved = await fetch(`${env.supabaseUrl}/rest/v1/recovery_sequences?on_conflict=user_id`, {
    method: "POST",
    headers: { ...memoryHeaders(env), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, touches: draft.body.touches, updated_at: new Date().toISOString() }),
  });
  if (!saved.ok) return { error: "The recovery emails were generated but couldn't be saved. Nothing was sent." };
  const totalValue = carts.reduce((sum, cart) => sum + (Number(cart.totalPrice) || 0), 0);
  const campaignSaved = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?select=id`, {
    method: "POST",
    headers: { ...memoryHeaders(env), Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, status: "proposed", touches: draft.body.touches, cart_count: carts.length, total_value: totalValue, currency: typeof audience.body.currency === "string" ? audience.body.currency : null }),
  });
  if (!campaignSaved.ok) return { error: "The draft was generated, but the campaign queue is not installed. Run the recovery campaign migration." };
  const campaignId = ((await campaignSaved.json()) as { id?: string }[])[0]?.id;
  if (!campaignId) return { error: "The campaign could not be persisted." };
  return {
    id: campaignId,
    created: true,
    status: "draft",
    sent: false,
    campaignType: "abandoned_checkout_recovery",
    touches: draft.body.touches,
    cartCount: carts.length,
    totalValue,
    currency: typeof audience.body.currency === "string" ? audience.body.currency : null,
    storeName: connection?.shop_domain.replace(/\.myshopify\.com$/i, "") ?? "your store",
    nextStep: "The merchant can approve this proposal to schedule the live recovery sequence.",
  };
}

async function createWinbackCampaign(env: SkillEnv, userId: string, authHeader: string | null, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const note = typeof args.note === "string" ? args.note.slice(0, 500) : "";
  const draft = await runRetentionDraft({ note }, authHeader, env);
  const templates = draft.body.templates as { winback?: unknown[]; review?: unknown[] } | undefined;
  if (draft.status !== 200 || !Array.isArray(templates?.winback)) return draft.body;
  const audience = await runRetentionCustomers(authHeader, env);
  if (audience.status !== 200 || !Array.isArray(audience.body.lapsed)) return audience.body;
  const allCustomers = audience.body.lapsed as { totalSpent?: number; ordersCount?: number; lastOrderAt?: string }[];
  const normalized = note.toLowerCase();
  const segment = /\bvip\b/.test(normalized) ? "vip" : /\brepeat\b/.test(normalized) ? "repeat" : /\brecently lapsed\b|\brecent segment\b/.test(normalized) ? "recent" : /\ball eligible\b/.test(normalized) ? "all" : "best";
  const ranked = [...allCustomers].sort((a, b) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0));
  const customers = segment === "all" ? allCustomers
    : segment === "repeat" ? allCustomers.filter((customer) => (Number(customer.ordersCount) || 0) >= 2)
      : segment === "recent" ? allCustomers.filter((customer) => Date.now() - Date.parse(customer.lastOrderAt ?? "") <= 120 * 86_400_000)
        : segment === "vip" ? ranked.slice(0, Math.max(1, Math.ceil(ranked.length * .25)))
          : (() => { const repeat = ranked.filter((customer) => (Number(customer.ordersCount) || 0) >= 2); return (repeat.length ? repeat : ranked).slice(0, Math.max(1, Math.ceil(ranked.length * .4))); })();
  const connection = await getConnection(env, userId);
  if (!env.supabaseUrl || !env.serviceRoleKey) return { error: "Persistent campaign storage is not configured." };
  const templateSave = await fetch(`${env.supabaseUrl}/rest/v1/retention_sequences?on_conflict=user_id`, { method: "POST", headers: { ...memoryHeaders(env), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: userId, templates: { winback: templates.winback, review: templates.review ?? [], reviewLink: "" }, updated_at: new Date().toISOString() }) });
  if (!templateSave.ok) return { error: "The win-back emails were generated but could not be saved. Nothing was sent." };
  const lifetimeValue = customers.reduce((sum, customer) => sum + (Number(customer.totalSpent) || 0), 0);
  const saved = await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?select=id`, { method: "POST", headers: { ...memoryHeaders(env), Prefer: "return=representation" }, body: JSON.stringify({ user_id: userId, status: "proposed", touches: templates.winback, segment, customer_count: customers.length, lifetime_value: lifetimeValue, currency: typeof audience.body.currency === "string" ? audience.body.currency : null }) });
  if (!saved.ok) {
    const failure = await saved.json().catch(() => ({})) as { code?: string; message?: string };
    log("error", "agent-chat", "winback_campaign_save_failed", { status: saved.status, code: failure.code ?? "unknown", message: failure.message?.slice(0, 160) });
    const missingTable = saved.status === 404 || failure.code === "42P01" || failure.code === "PGRST205";
    return { error: missingTable
      ? "The win-back campaign table is missing from the connected Supabase database. Apply the win-back migration to that project."
      : `The win-back draft was generated but the database rejected it${failure.code ? ` (${failure.code})` : ""}${failure.message ? `: ${failure.message}` : ""}. Nothing was sent.` };
  }
  const id = ((await saved.json()) as { id?: string }[])[0]?.id;
  return id ? { id, created: true, sent: false, touches: templates.winback, customerCount: customers.length, lifetimeValue, currency: audience.body.currency ?? null, storeName: connection?.shop_domain.replace(/\.myshopify\.com$/i, "") ?? "your store" } : { error: "The campaign could not be persisted." };
}

async function createBroadcastCampaign(env: SkillEnv, authHeader: string | null, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requestedAt = typeof args.scheduledAt === "string" ? args.scheduledAt : "";
  const scheduledAt = Number.isFinite(Date.parse(requestedAt))
    ? new Date(requestedAt).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const response = await runBroadcastAction({
    action: "create",
    name: args.name,
    segment: args.segment,
    subject: args.subject,
    body: args.body,
    scheduledAt,
  }, authHeader, env);
  const result = await response.json().catch(() => ({ error: "The one-time campaign could not be saved." })) as Record<string, unknown>;
  if (!response.ok) return result;
  const campaign = result.campaign as Record<string, unknown> | undefined;
  return campaign ? { ...campaign, created: true, sent: false } : { error: "The one-time campaign could not be persisted." };
}

function buildSystemPrompt(shop: string, catalogBlock: string, persistentContext: string): string {
  return [
    `You are Evolution, the AI COO for the founder's connected Shopify store "${shop}". You are their store-aware copilot; replies may be spoken aloud.`,
    `You have TOOLS that fetch the store's REAL data, live. When a question needs data you don't already have — sales, top sellers, order stats, abandoned carts (including WHICH products get abandoned most), what's waiting to ship, stock levels, lapsed customers, audit findings, deeper product detail — CALL the right tool instead of guessing, deflecting, or claiming you lack data. Check your tools before ever saying you can't see something.`,
    `Every number you state must come from a tool result or the catalog below — NEVER invent figures. If a tool returns an "error" field, say plainly that that data source is unreachable right now and answer with what you have. Never infer or guess a product identity from a checkout total or price.`,
    `When the merchant asks to create, build, prepare, or draft an abandoned-checkout campaign, call create_recovery_campaign. For a win-back campaign, call create_winback_campaign. For a one-time, broadcast, promotion, launch, or announcement email, call create_broadcast_campaign. A follow-up such as "create it" may use only the immediately preceding recommendation; if the campaign type is still unclear, ask the merchant to choose one-time, win-back, or cart recovery. Never guess from older conversation. Never print tool-call syntax, XML-like <function> tags, or pretend to call a tool in prose. These tools create saved drafts only; clearly distinguish CREATED AS DRAFT from SENT.`,
    `Keep replies SHORT and conversational (1–4 sentences); use a compact list only when the founder asks for a list. No preamble like "Based on the data".`,
    `You can PREPARE Shopify action proposals when the founder asks for a concrete supported change. If they say add, create, apply, update, fix, or "do this in my store", you MUST call the matching prepare_* tool instead of repeating the recommendation or merely explaining it. Treat "this", "that", and "these" as referring to the products or changes in the immediately preceding conversation. For a recommended product that is not already in their catalog, call prepare_product_draft. Proposal tools never execute; they create a before-and-after approval card. Tell the founder to review and click Approve and apply. Never claim a change is live until the action result says it succeeded. You cannot change prices, inventory, fulfillment, customers, themes, or publish products.`,
    `Don't just report numbers — read them like a COO and suggest the next move. A product topping the abandoned-cart list is a discount/free-shipping candidate; sold-out products with recent demand are urgent restocks; overdue shipments risk bad reviews; lapsed customers who bought a product you still stock are a win-back audience. One concrete suggestion beats three vague ones.`,
    `The Marketing Manager workspace contains abandoned-cart recovery, win-back campaigns, and one-time email campaigns. Chat and visible controls use the same backend campaign records. Chat may create drafts, but sending or scheduling still requires the merchant's explicit approval; never claim an email was sent or scheduled unless an action result proves it.`,
    `The SEO Manager covers Product SEO and AI/GEO optimization. For any requested SEO/GEO edit, call get_product_detail for each target first, preserve all factual product claims, then call prepare_product_updates. Never invent specifications, materials, benefits, comparisons, reviews, certifications, or FAQs. An action exists only when the proposal tool returns an action object; otherwise report the exact error.`,
    `Use persistent memory carefully. If the merchant explicitly says "remember", "always", "our policy is", or states a durable business preference or decision, call remember_business_fact. Never save customer PII, credentials, payment data, access tokens, or a one-off request. Never claim something was saved unless the tool confirms it. Live Shopify tool data always wins over stale conversation context.`,
    persistentContext,
    catalogBlock,
  ].join("\n\n");
}

export function forcedProposalTool(turns: ChatTurn[]): (typeof AGENT_TOOL_NAMES)[number] | null {
  const latest = turns.at(-1)?.content.toLowerCase() ?? "";
  const context = turns.slice(-4).map((turn) => turn.content.toLowerCase()).join("\n");
  const directAction = /\b(add|create|apply|update|change|fix|prepare|recreate|do)\b.*\b(store|shop|product|listing|collection|discount|promotion|card)\b/.test(latest)
    || /\b(where|how)\b.*\b(approve|approval|card)\b/.test(latest)
    || /\b(add|apply|do|create)\s+(this|that|these|it)\b/.test(latest);
  if (!directAction) return null;
  if (/\b(seo|geo|search title|meta description|alt text|ai discover)\b/.test(context)) return null;
  if (/\b(discount|promotion|coupon|free shipping)\b/.test(context)) return "prepare_discount";
  if (/\bcollection\b/.test(context)) return "prepare_collection";
  if (/\b(draft product|winning product|recommended product|add this|add these|new product)\b/.test(context)) return "prepare_product_draft";
  return "prepare_product_updates";
}

type CampaignTool = "create_recovery_campaign" | "create_winback_campaign" | "create_broadcast_campaign";

function campaignToolInText(textRaw: string): CampaignTool | null {
  const text = textRaw.toLowerCase();
  if (/\b(one[\s_-]?time|broadcast|newsletter|email blast|announcement email|create_one_time_campaign|campaign (?:for|to) (?:all )?(?:subscribers|customers))\b/.test(text)) return "create_broadcast_campaign";
  if (/\b(win.?back|lapsed|inactive customer|retention campaign)\b/.test(text)) return "create_winback_campaign";
  if (/\b(abandoned|checkout|cart recovery|recovery campaign|three-email|3-email)\b/.test(text)) return "create_recovery_campaign";
  return null;
}

function forcedCampaignTool(turns: ChatTurn[]): CampaignTool | null {
  const latest = turns.at(-1)?.content.toLowerCase() ?? "";
  const createIntent = /\b(create|build|prepare|draft|do it|go ahead|yes|okay|ok|proceed)\b/.test(latest);
  if (!createIntent) return null;
  const explicit = campaignToolInText(latest);
  if (explicit) return explicit;
  // A short confirmation may inherit only the immediately preceding
  // assistant recommendation. Older history is never used to guess intent.
  const previous = turns.at(-2);
  return previous?.role === "assistant" ? campaignToolInText(previous.content) : null;
}

function needsCampaignClarification(turns: ChatTurn[]): boolean {
  const latest = turns.at(-1)?.content.toLowerCase() ?? "";
  const ambiguousCampaignRequest = /\b(create|build|prepare|draft)\b.*\b(email )?campaign\b/.test(latest) && !campaignToolInText(latest);
  const genericConfirmation = /^(?:ah+a+\s+)?(?:yes|okay|ok|sure|proceed|go ahead|do it|create it|create this|create that)[.!\s]*$/.test(latest.trim());
  if (!ambiguousCampaignRequest && !genericConfirmation) return false;
  if (forcedCampaignTool(turns)) return false;
  return ambiguousCampaignRequest || turns.slice(-6, -1).some((turn) => campaignToolInText(turn.content));
}

export function selectedAgentToolNames(turns: ChatTurn[]): (typeof AGENT_TOOL_NAMES)[number][] {
  const context = turns.slice(-6).map((turn) => turn.content.toLowerCase()).join("\n");
  const selected = new Set<(typeof AGENT_TOOL_NAMES)[number]>(["remember_business_fact"]);
  const add = (...names: (typeof AGENT_TOOL_NAMES)[number][]) => names.forEach((name) => selected.add(name));

  if (/\b(abandon|checkout|cart recovery|recovery campaign)\b/.test(context)) {
    add("get_abandoned_checkouts", "create_recovery_campaign", "prepare_discount");
  }
  if (/\b(win.?back|retention|lapsed|repeat customer|review)\b/.test(context)) {
    add("get_retention_snapshot", "get_orders_summary", "create_winback_campaign", "prepare_discount");
  }
  if (/\b(one[ -]?time|broadcast|newsletter|email blast|announcement email|marketing subscribers)\b/.test(context)) {
    add("get_retention_snapshot", "get_orders_summary", "create_broadcast_campaign");
  }
  if (/\b(ship|fulfil|fulfill|inventory|stock|operations|ops)\b/.test(context)) {
    add("get_ship_queue", "get_inventory_watch", "get_orders_summary");
  }
  if (/\b(product|catalog|listing|collection|seo|merchand|price)\b/.test(context)) {
    add("get_products", "get_product_detail", "get_product_sales", "get_latest_audit", "prepare_product_updates", "prepare_product_draft", "prepare_collection");
  }
  if (/\b(discount|promotion|coupon|free shipping)\b/.test(context)) {
    add("prepare_discount", "get_orders_summary");
  }
  if (/\b(order|revenue|sales|performance|summary|opportunity)\b/.test(context)) {
    add("get_orders_summary", "get_product_sales", "get_latest_audit");
  }
  if (selected.size === 1) add("get_orders_summary", "get_latest_audit");
  return [...selected];
}

async function buildCatalogBlock(ctx: ToolCtx): Promise<string> {
  if (!ctx.conn) return "No catalog available.";
  const digest = await buildProductsDigest(ctx.conn, 100);
  if ("error" in digest) {
    return `The catalog couldn't be fetched right now (${digest.error}). Use get_products if the founder asks about products.`;
  }
  const products = digest.products as {
    id: string;
    title: string;
    soldOut: boolean;
    priceMin: number | null;
    priceMax: number | null;
  }[];
  const lines = products.slice(0, 50).map((p, i) => {
    const price =
      p.priceMin == null
        ? "price not set"
        : p.priceMax == null || p.priceMax === p.priceMin
          ? `$${p.priceMin}`
          : `$${p.priceMin}-$${p.priceMax}`;
    return `${i + 1}. ${p.title} [${p.id}] — ${price}${p.soldOut ? " (sold out)" : ""}`;
  });
  const total = typeof digest.aggregate.total === "number" ? digest.aggregate.total : products.length;
  return (
    `Their LIVE catalog, fetched just now (${total} products${total > lines.length ? `, first ${lines.length} shown` : ""}) — answer listing/count/price/sold-out questions directly from it:\n` +
    lines.join("\n")
  );
}

export async function runAgentChat(
  body: AgentChatBody,
  authHeader: string | null,
  origin: string,
  env: SkillEnv,
): Promise<Response> {
  const turns = validateTurns(body.messages);
  if (!turns) return jsonResponse(400, { error: "Invalid messages." });

  if (!env.groqKey) return jsonResponse(503, { error: "The copilot brain isn't configured yet." });

  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResponse(401, { error: "Sign in to chat with your store." });
  if (!(await isOperator(env, user.id, user.email))) {
    return jsonResponse(OPERATOR_REQUIRED.status, { ...OPERATOR_REQUIRED.body });
  }

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResponse(409, { error: "Connect your Shopify store first." });

  const ctx: ToolCtx = { env, userId: user.id, userEmail: user.email, conn, origin };
  const shop = conn.shop_domain.replace(".myshopify.com", "");
  const model = env.groqModel || CHAT_MODEL_DEFAULT;
  const clarifyCampaign = needsCampaignClarification(turns);
  const recentText = turns.slice(-6).map(turn=>turn.content.toLowerCase()).join("\n");
  const seoIntent = /\b(seo|geo|search title|meta description|alt text|ai discover)\b/.test(recentText);
  const hasExplicitProductId = /gid:\/\/shopify\/product\/\d+/i.test(recentText);
  const forcedTool = (seoIntent && hasExplicitProductId ? "get_product_detail" : null) ?? forcedCampaignTool(turns) ?? forcedProposalTool(turns);
  const selectedNames = selectedAgentToolNames(turns);
  if (forcedTool && !selectedNames.includes(forcedTool)) selectedNames.push(forcedTool);
  const tools = selectedNames.map((n) => PROPOSAL_SCHEMAS[n] ?? SKILL_TOOLS[n].schema);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const progress = (label: string) => controller.enqueue(sse({ progress: label }));
      const detailedProductIds = new Set<string>();
      try {
        if (clarifyCampaign) {
          controller.enqueue(sse({ choices: [{ delta: { content: "Which campaign should I create?\n\n- One-time email — a promotion, launch, or announcement to subscribed customers\n- Win-back — re-engage eligible lapsed customers\n- Cart recovery — follow up on abandoned checkouts\n\nI’ll create a draft only; nothing will be sent until you approve it." } }] }));
          return;
        }
        if (forcedTool === "create_recovery_campaign" || forcedTool === "create_winback_campaign") {
          progress(PROGRESS_LABELS[forcedTool]);
          const recentInstructions = turns
            .slice(-6)
            .filter((turn) => turn.role === "user")
            .map((turn) => turn.content)
            .join("\n")
            .slice(-500);
          const direct = forcedTool === "create_winback_campaign"
            ? await createWinbackCampaign(env, user.id, authHeader, { note: recentInstructions || "Create a safe win-back campaign draft." })
            : await createRecoveryCampaign(env, user.id, authHeader, { note: recentInstructions || "Create a safe recovery campaign draft." });
          if (typeof direct.error === "string") {
            controller.enqueue(sse({ error: direct.error }));
            return;
          }
          const touches = Array.isArray(direct.touches)
            ? direct.touches as { delayLabel?: string; subject?: string }[]
            : [];
          const plan = touches.map((touch, index) => `${index + 1}. ${touch.delayLabel ?? `Email ${index + 1}`} — ${touch.subject ?? "Draft email"}`).join("\n");
          const proposal = {
            id: String(direct.id),
            status: "proposed",
            touches: direct.touches,
            cartCount: Number(direct.cartCount ?? 0),
            totalValue: Number(direct.totalValue ?? 0),
            currency: typeof direct.currency === "string" ? direct.currency : null,
            storeName: typeof direct.storeName === "string" ? direct.storeName : "your store",
            deliveryReady: false,
            createdAt: new Date().toISOString(),
          };
          controller.enqueue(sse(forcedTool === "create_winback_campaign"
            ? { winbackProposal: { ...proposal, customerCount: Number(direct.customerCount ?? 0), lifetimeValue: Number(direct.lifetimeValue ?? 0) } }
            : { recoveryProposal: proposal }));
          const summary = forcedTool === "create_winback_campaign" ? "I checked the eligible lapsed customers and prepared a two-email win-back campaign for approval." : "I checked the live recoverable carts and prepared customer-specific emails for approval.";
          controller.enqueue(sse({ choices: [{ delta: { content: `${summary} Nothing was sent.\n${plan}` } }] }));
          return;
        }
        const persistentContext = await loadPersistentContext(env, user.id, turns);
        const catalogBlock = "Catalog is available on demand through get_products; it is not preloaded into every request.";
        const convo: Record<string, unknown>[] = [
          { role: "system", content: buildSystemPrompt(shop, catalogBlock, persistentContext) },
          ...turns,
        ];

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const lastRound = round === MAX_TOOL_ROUNDS;
          const res = await fetch(`${GROQ_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.groqKey}` },
            body: JSON.stringify({
              model,
              messages: convo,
              temperature: 0.4,
              max_tokens: CHAT_MAX_COMPLETION_TOKENS,
              ...(lastRound ? {} : {
                tools,
                tool_choice: round === 0 && forcedTool
                  ? { type: "function", function: { name: forcedTool } }
                  : "auto",
              }),
            }),
            signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            log("error", "agent-chat", "groq_upstream", { status: res.status, round });
            let upstreamMessage = "";
            try {
              const parsed = JSON.parse(detail) as { error?: { message?: string } };
              upstreamMessage = parsed.error?.message?.trim().slice(0, 240) ?? "";
            } catch {
              upstreamMessage = detail.trim().slice(0, 240);
            }
            const publicError = res.status === 401
              ? "The configured Groq API key was rejected. Restart or redeploy after updating the key."
              : res.status === 413
                ? "This conversation is too large for the configured model. Start a fresh chat or reduce stored context."
                : res.status === 429
                  ? `Groq rejected this request for rate or quota limits.${upstreamMessage ? ` ${upstreamMessage}` : " Check the Groq usage dashboard."}`
                  : res.status === 404
                    ? "The configured Groq model is unavailable or incorrectly named."
                    : `Groq request failed (${res.status}).${upstreamMessage ? ` ${upstreamMessage}` : ""}`;
            controller.enqueue(sse({ error: publicError }));
            return;
          }
          const data = (await res.json()) as {
            choices?: { message?: GroqChatMessage }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          if (data.usage) {
            log("info", "agent-chat", "groq_usage", {
              model,
              round,
              selectedTools: selectedNames.length,
              promptTokens: data.usage.prompt_tokens ?? 0,
              completionTokens: data.usage.completion_tokens ?? 0,
              totalTokens: data.usage.total_tokens ?? 0,
            });
          }
          const msg = data.choices?.[0]?.message;
          if (!msg) {
            controller.enqueue(sse({ error: "The copilot brain returned an empty response." }));
            return;
          }

          const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
          if (calls.length === 0 || lastRound) {
            const text = (msg.content ?? "").trim();
            if (!text) {
              controller.enqueue(sse({ error: "The copilot brain returned an empty reply." }));
              return;
            }
            controller.enqueue(sse({ choices: [{ delta: { content: text } }] }));
            return;
          }

          // Execute this round's tool calls, then loop with the results.
          convo.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
          for (const call of calls) {
            const name = call.function.name;
            const isMemory = name === "remember_business_fact";
            const isCampaign = name === "create_recovery_campaign" || name === "create_winback_campaign" || name === "create_broadcast_campaign";
            const isProposal = Boolean(PROPOSAL_SCHEMAS[name]) && !isMemory && !isCampaign;
            const tool = !isProposal && (AGENT_TOOL_NAMES as readonly string[]).includes(name)
              ? SKILL_TOOLS[name]
              : null;
            progress(PROGRESS_LABELS[name] ?? "Checking your store data…");
            let result: unknown;
            if (!tool && !isProposal && !isMemory && !isCampaign) {
              result = { error: `Unknown tool: ${name}` };
            } else {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
              } catch {
                /* run with defaults */
              }
              if (isMemory) {
                result = await rememberBusinessFact(env, user.id, args);
              } else if (isCampaign) {
                result = name === "create_winback_campaign"
                  ? await createWinbackCampaign(env, user.id, authHeader, args)
                  : name === "create_broadcast_campaign"
                    ? await createBroadcastCampaign(env, authHeader, args)
                    : await createRecoveryCampaign(env, user.id, authHeader, args);
                if (name === "create_broadcast_campaign" && (result as { created?: unknown }).created === true) {
                  controller.enqueue(sse({ broadcastProposal: result }));
                }
                if (name === "create_broadcast_campaign" && typeof (result as { error?: unknown }).error === "string") {
                  const reason = (result as { error: string }).error;
                  const content = reason === "This segment has no subscribed customers."
                    ? "Shopify currently shows 0 customers subscribed to email marketing, so I can't create or send this campaign—even with merchant approval. Nothing was sent. If you have customers who already gave consent, update their email-marketing status in Shopify and ask me again; otherwise, collect subscriptions first."
                    : `I couldn't create the one-time campaign draft: ${reason} Nothing was sent, and there is no campaign waiting for approval.`;
                  controller.enqueue(sse({ choices: [{ delta: { content } }] }));
                  return;
                }
              } else if (isProposal) {
                if (name === "prepare_product_updates" && seoIntent) {
                  const ids = Array.isArray(args.items) ? args.items.map(item=>String((item as Record<string,unknown>).productId??"")) : [];
                  const missing = ids.filter(id=>!detailedProductIds.has(id));
                  if (missing.length) {
                    result = { error: "Fetch each target with get_product_detail before preparing SEO/GEO changes." };
                    convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
                    continue;
                  }
                }
                const proposalBody = name === "prepare_product_updates"
                  ? { kind: "product_update", ...args }
                  : name === "prepare_product_draft"
                    ? { kind: "product_draft_create", ...args }
                    : name === "prepare_collection"
                      ? { kind: "collection_upsert", ...args }
                      : { kind: args.automatic ? "discount_automatic_create" : "discount_code_create", ...args };
                const response = await runActionPropose(proposalBody, authHeader, env);
                result = await response.json();
                const action = (result as { action?: unknown }).action;
                if (action) controller.enqueue(sse({ action }));
                else if (typeof (result as {error?:unknown}).error === "string") {
                  controller.enqueue(sse({ choices: [{ delta: { content: `I couldn't create the approval proposal: ${(result as {error:string}).error} Nothing was changed in Shopify, and there is no approval card waiting.` } }] }));
                  return;
                }
              } else {
                result = await tool!.run(ctx, args).catch((err) => ({ error: String(err).slice(0, 200) }));
                if (name === "get_product_detail" && !(result as {error?:unknown}).error && typeof args.productId === "string") detailedProductIds.add(args.productId);
              }
            }
            convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          }
        }
      } catch (err) {
        log("error", "agent-chat", "run_failed", { reason: String(err).slice(0, 160) });
        controller.enqueue(sse({ error: `Chat failed: ${String(err).slice(0, 160)}` }));
      } finally {
        controller.enqueue(sseDone);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
