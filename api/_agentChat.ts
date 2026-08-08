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
 * Flow per turn: auth → prefetch a compact catalog block (cheap, makes
 * catalog questions instant) → up to MAX_TOOL_ROUNDS Groq calls with
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

/**
 * Tools the chat may call — read-only store data. file_task is deliberately
 * NOT exposed: with no write access anywhere yet, the bot must never promise
 * that a change will be made; it advises instead (re-add when fixes ship).
 */
const AGENT_TOOL_NAMES = [
  "get_products",
  "get_product_sales",
  "get_orders_summary",
  "get_abandoned_checkouts",
  "get_latest_audit",
  "get_ship_queue",
  "get_inventory_watch",
  "get_retention_snapshot",
  "prepare_product_updates",
  "prepare_product_draft",
  "prepare_collection",
  "prepare_discount",
] as const;

const PROPOSAL_SCHEMAS: Record<string, ToolSchema> = {
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
                seoTitle: { type: "string" }, seoDescription: { type: "string" }, tags: { type: "array", items: { type: "string" } },
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
  prepare_product_updates: "Preparing product changes for your approval…",
  prepare_product_draft: "Preparing an unpublished product draft…",
  prepare_collection: "Preparing the collection change…",
  prepare_discount: "Preparing the promotion for your approval…",
};

/** Tool rounds before we force a plain answer — enough for lookup + follow-up. */
const MAX_TOOL_ROUNDS = 4;
const GROQ_TIMEOUT_MS = 25_000;
/** Client history is advisory; the server enforces its own tighter cap. */
const MAX_HISTORY_TURNS = 12;

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

function buildSystemPrompt(shop: string, catalogBlock: string): string {
  return [
    `You are Evolution, the AI COO for the founder's connected Shopify store "${shop}". You are their store-aware copilot; replies may be spoken aloud.`,
    `You have TOOLS that fetch the store's REAL data, live. When a question needs data you don't already have — sales, top sellers, order stats, abandoned carts (including WHICH products get abandoned most), what's waiting to ship, stock levels, lapsed customers, audit findings, deeper product detail — CALL the right tool instead of guessing, deflecting, or claiming you lack data. Check your tools before ever saying you can't see something.`,
    `Every number you state must come from a tool result or the catalog below — NEVER invent figures. If a tool returns an "error" field, say plainly that that data source is unreachable right now and answer with what you have.`,
    `Keep replies SHORT and conversational (1–4 sentences); use a compact list only when the founder asks for a list. No preamble like "Based on the data".`,
    `You can PREPARE Shopify action proposals when the founder asks for a concrete supported change. Proposal tools never execute; they create a before-and-after approval card. Tell the founder to review and click Approve and apply. Never claim a change is live until the action result says it succeeded. You cannot change prices, inventory, fulfillment, customers, themes, or publish products.`,
    `Don't just report numbers — read them like a COO and suggest the next move. A product topping the abandoned-cart list is a discount/free-shipping candidate; sold-out products with recent demand are urgent restocks; overdue shipments risk bad reviews; lapsed customers who bought a product you still stock are a win-back audience. One concrete suggestion beats three vague ones.`,
    `The app has action centers as header buttons — point the founder to the right one AFTER answering with data: "Recovery" (every recoverable abandoned cart with a personalized ready-to-send email; they send from their own inbox), "Retention" (win-back emails for lapsed customers + review requests for recent buyers, same send-it-yourself flow), and "Ops" (live operator view: today's pulse, ship queue, inventory watch, real-time alerts for new orders and stockouts). Nothing is sent automatically — the founder always does the sending.`,
    catalogBlock,
  ].join("\n\n");
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
  if (!(await isOperator(env, user.id))) {
    return jsonResponse(OPERATOR_REQUIRED.status, { ...OPERATOR_REQUIRED.body });
  }

  const conn = await getConnection(env, user.id);
  if (!conn) return jsonResponse(409, { error: "Connect your Shopify store first." });

  const ctx: ToolCtx = { env, userId: user.id, userEmail: user.email, conn, origin };
  const shop = conn.shop_domain.replace(".myshopify.com", "");
  const model = env.groqModel || CHAT_MODEL_DEFAULT;
  const tools = AGENT_TOOL_NAMES.map((n) => PROPOSAL_SCHEMAS[n] ?? SKILL_TOOLS[n].schema);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const progress = (label: string) => controller.enqueue(sse({ progress: label }));
      try {
        const catalogBlock = await buildCatalogBlock(ctx);
        const convo: Record<string, unknown>[] = [
          { role: "system", content: buildSystemPrompt(shop, catalogBlock) },
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
              ...(lastRound ? {} : { tools, tool_choice: "auto" }),
            }),
            signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            log("error", "agent-chat", "groq_upstream", { status: res.status, round });
            controller.enqueue(
              sse({
                error:
                  res.status === 429 || res.status === 413
                    ? "I'm at capacity this minute — give me about 60 seconds and ask again."
                    : `Copilot brain error (${res.status}). ${detail.slice(0, 120)}`,
              }),
            );
            return;
          }
          const data = (await res.json()) as { choices?: { message?: GroqChatMessage }[] };
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
            const isProposal = Boolean(PROPOSAL_SCHEMAS[name]);
            const tool = !isProposal && (AGENT_TOOL_NAMES as readonly string[]).includes(name)
              ? SKILL_TOOLS[name]
              : null;
            progress(PROGRESS_LABELS[name] ?? "Checking your store data…");
            let result: unknown;
            if (!tool && !isProposal) {
              result = { error: `Unknown tool: ${name}` };
            } else {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
              } catch {
                /* run with defaults */
              }
              if (isProposal) {
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
              } else {
                result = await tool!.run(ctx, args).catch((err) => ({ error: String(err).slice(0, 200) }));
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
