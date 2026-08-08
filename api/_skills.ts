/**
 * The skill engine — shared by /api/skill (edge) and dev-api.ts.
 *
 * A skill run is the agentic path: the signed-in owner picks a skill, we
 * fetch their REAL store data through the read-only Admin API token
 * (server-side only), compute digests in code (_skillTools.ts), and stream
 * one Groq call that writes the markdown report. The model narrates; the
 * code counts — every number in a report was computed deterministically.
 *
 * Escalation ("fix this for me") is deliberately NOT an LLM tool call: the
 * client posts the `file_fixes` concierge skill, which files a row in the
 * tasks ops queue and emails the team (_email.ts, best-effort). Deterministic
 * beats a model deciding whether to call file_task.
 *
 * Stream protocol (SSE) — the client's parser routes by shape:
 *   data: {"progress":"Fetching your products…"}      status line updates
 *   data: {"choices":[{"delta":{"content":"…"}}]}     report tokens (OpenAI shape)
 *   data: {"meta":{"taskId":"…","emailed":true}}      concierge result
 *   data: {"error":"…"}                                terminal failure
 *   data: [DONE]
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT, RESEARCH_MODEL_DEFAULT } from "./_shared";
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, shopifyEnvFromProcess } from "./_shopify";
import { SKILL_TOOLS, type SkillEnv, type ToolCtx } from "./_skillTools";
import { sendTaskEmail } from "./_email";
import { log } from "./_log";

/** Keep ids in lockstep with the client mirror in src/lib/skills.ts. */
export interface SkillDef {
  id: string;
  label: string;
  kind: "agentic" | "concierge";
  progressLabel: string;
  /** Deterministic prefetch — no LLM round wasted picking obvious tools. */
  prefetch: { tool: string; args: Record<string, unknown> }[];
  /** Optional digest slimming before it enters model context. */
  shape?: (digests: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Web-research skill: runs on the search-capable model (RESEARCH_MODEL_DEFAULT)
   * with a longer stream budget, and the grounding rules flip — store facts come
   * from the digests, market facts must come from live searches with cited URLs.
   */
  web?: boolean;
  /** Status line while the model writes (research skills say what's really happening). */
  writingLabel?: string;
  prompt: string;
  maxTokens: number;
}

const ESCALATION_LINE =
  "End the report with exactly one short closing line inviting the founder to ask you in chat to prepare an approval card for any supported product, collection, or discount fix above. Never claim a change is live before the founder approves it and execution succeeds.";

export const SKILLS: Record<string, SkillDef> = {
  product_audit: {
    id: "product_audit",
    label: "Product listing audit",
    kind: "agentic",
    progressLabel: "Fetching your products from Shopify…",
    prefetch: [{ tool: "get_products", args: { limit: 100 } }],
    prompt: `Write a product listing audit. Structure: "## Product listing audit — {shop}" then a 2–3 sentence executive summary with the headline numbers from the aggregate block, then sections "### Descriptions" (missing/thin counts, name the worst offenders by title), "### Images & alt text", "### Stock" (sold-out products by name), "### Titles & organization" (duplicates, tag hygiene), then "### Do this week" — a numbered priority list of at most 5 concrete actions, most valuable first. ${ESCALATION_LINE}`,
    maxTokens: 1300,
  },
  product_research: {
    id: "product_research",
    label: "Find winning products",
    kind: "agentic",
    progressLabel: "Reading your catalog to pin down your niche…",
    prefetch: [{ tool: "get_products", args: { limit: 100 } }],
    web: true,
    writingLabel: "Researching live market trends on the web — this takes a minute…",
    shape: (digests) => {
      const d = digests.get_products as
        | {
            products?: { title: string; status: string; priceMin: number | null; priceMax: number | null }[];
            aggregate?: Record<string, unknown>;
          }
        | undefined;
      if (!d?.products) return digests;
      // The researcher needs the niche and price band, not listing-quality flags.
      const active = d.products.filter((p) => p.status === "active");
      return {
        store_catalog: {
          totalProducts: d.aggregate?.total ?? d.products.length,
          // 30 titles is plenty to pin the niche, and keeps the request small
          // enough that the search context fits free-tier token windows.
          products: (active.length ? active : d.products)
            .slice(0, 30)
            .map((p) => ({ title: p.title, priceMin: p.priceMin, priceMax: p.priceMax })),
        },
      };
    },
    prompt: `The founder wants winning products to add to this store. Research the live market FIRST — run web searches for products trending right now in and adjacent to this store's niche (infer the niche from the catalog digest): current trending-product and marketplace best-seller roundups, demand signals (search and social trend reports), and real supplier listings for pricing. Only then write the report. Structure: "## Winning products research — {shop}" then a 2–3 sentence executive summary naming the store's niche and which one product you'd launch first, then "### Your catalog today" (max 2 sentences: what the store sells and its price band, from the digest), then "### 3 winning products" — a "#### {n}. {Product}" block per product, each with exactly these bolded fields: **Why it's winning now** (the trend evidence you found, with the source linked), **Numbers** (typical supplier unit cost vs suggested retail and rough margin, from listings you actually found), **Sourcing** (2–3 named places to source it — e.g. AliExpress, CJdropshipping, Faire, Alibaba — with what to search there, linking listings you found), **Fit** (one line on why it suits THIS store and its price band), then "### Launch checklist" — 4–5 numbered steps to get the first product live this week. Every trend claim and price must come from a search result you cite; if you can't verify a candidate, replace it rather than pad with guesses. ${ESCALATION_LINE}`,
    maxTokens: 1400,
  },
  cart_recovery: {
    id: "cart_recovery",
    label: "Cart recovery report",
    kind: "agentic",
    progressLabel: "Pulling your abandoned checkouts…",
    prefetch: [
      { tool: "get_abandoned_checkouts", args: { days: 30 } },
      { tool: "get_orders_summary", args: { days: 30 } },
    ],
    prompt: `Write an abandoned-cart recovery report. Structure: "## Cart recovery — {shop}" then a summary contrasting completed revenue vs abandoned value (30 days), then "### What's being left behind" (count, total and average value, how many left an email = recoverable), "### What a recovery flow would win back" (use the industry 5–15% recovery range applied to the real abandoned value — show the math), "### The 3-touch sequence we recommend" (timing: ~1h, ~24h, ~72h; one line each on the angle). End the report with exactly one short closing line pointing the founder to the "Recovery" button at the top of the app, where every recoverable cart already has personalized, ready-to-send emails prepared for them to send from their own inbox.`,
    maxTokens: 1100,
  },
  retention: {
    id: "retention",
    label: "Retention & reviews snapshot",
    kind: "agentic",
    progressLabel: "Analyzing 90 days of orders…",
    prefetch: [
      { tool: "get_orders_summary", args: { days: 90 } },
      { tool: "get_latest_audit", args: {} },
    ],
    prompt: `Write a retention snapshot. Structure: "## Retention snapshot — {shop}" then a summary, then "### Repeat purchase rate" (the real 90-day number vs the 20–30% healthy DTC range; weekly order trend if the buckets show one), "### Reviews & social proof" (use the latest audit's reviews finding if present — otherwise say the audit found no issue), "### The cheapest revenue you're not collecting" (win-back and review-request math from AOV × customer counts — show assumptions). ${ESCALATION_LINE}`,
    maxTokens: 1000,
  },
  back_in_stock: {
    id: "back_in_stock",
    label: "Back-in-stock check",
    kind: "agentic",
    progressLabel: "Checking your inventory…",
    prefetch: [{ tool: "get_products", args: { limit: 100 } }],
    shape: (digests) => {
      const d = digests.get_products as
        | { products?: { soldOut?: boolean }[]; aggregate?: unknown }
        | undefined;
      if (!d?.products) return digests;
      return { get_products: { aggregate: d.aggregate, soldOutProducts: d.products.filter((p) => p.soldOut) } };
    },
    prompt: `Write a back-in-stock report. Structure: "## Back-in-stock check — {shop}" then a summary, then "### Sold-out right now" (every sold-out product by name and price — these pages are dead ends today), "### What that costs" (estimate lost demand honestly: visitors landing on dead pages leave; if nothing is sold out, say so plainly and keep the report short), "### The fix" (a notify-me capture on each sold-out page + a restock alert list). ${ESCALATION_LINE}`,
    maxTokens: 900,
  },
  file_fixes: {
    id: "file_fixes",
    label: "Queue this fix",
    kind: "concierge",
    progressLabel: "Adding this to my work queue…",
    prefetch: [],
    prompt: "",
    maxTokens: 0,
  },
};

/** Env bundle for the deployed edge functions (dev-api builds its own via loadEnv). */
export function skillEnvFromProcess(): SkillEnv {
  return {
    ...shopifyEnvFromProcess(),
    resendKey: (process.env.RESEND_API_KEY ?? "").trim(),
    resendFrom: (process.env.RESEND_FROM ?? "").trim(),
    teamEmails: (process.env.TEAM_NOTIFY_EMAILS ?? "").trim(),
  };
}

export const SKILL_NOTE_MAX_CHARS = 2_000;
const GROQ_TIMEOUT_MS = 15_000;

export interface SkillRunBody {
  skillId?: unknown;
  note?: unknown;
  taskTool?: unknown;
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

export async function runSkill(
  body: SkillRunBody,
  authHeader: string | null,
  origin: string,
  env: SkillEnv,
): Promise<Response> {
  const skill = SKILLS[String(body.skillId ?? "")];
  if (!skill) return jsonResponse(400, { error: "Unknown skill." });

  const note = typeof body.note === "string" ? body.note.slice(0, SKILL_NOTE_MAX_CHARS).trim() : "";

  const user = await resolveUserFull(env, authHeader);
  if (!user) return jsonResponse(401, { error: "Sign in to run skills." });
  if (!(await isOperator(env, user.id))) {
    return jsonResponse(OPERATOR_REQUIRED.status, { ...OPERATOR_REQUIRED.body });
  }

  const conn = await getConnection(env, user.id);
  if (skill.kind === "agentic" && !conn) {
    return jsonResponse(409, { error: "Connect your Shopify store first — skills run on your real store data." });
  }
  if (skill.kind === "agentic" && !env.groqKey) {
    return jsonResponse(503, { error: "The report writer isn't configured yet. Try again shortly." });
  }

  const ctx: ToolCtx = { env, userId: user.id, userEmail: user.email, conn, origin };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const progress = (text: string) => controller.enqueue(sse({ progress: text }));
      try {
        if (skill.kind === "concierge") {
          await runConcierge(skill, ctx, note, body, controller, progress);
        } else {
          await runAgentic(skill, ctx, note, controller, progress);
        }
      } catch (err) {
        controller.enqueue(sse({ error: `Skill run failed: ${String(err).slice(0, 160)}` }));
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

// ---------------------------------------------------------------------------

async function runConcierge(
  skill: SkillDef,
  ctx: ToolCtx,
  note: string,
  body: SkillRunBody,
  controller: ReadableStreamDefaultController<Uint8Array>,
  progress: (t: string) => void,
): Promise<void> {
  progress(skill.progressLabel);
  const request = note || "The founder asked Evolution's team to take over fixes from a skill report.";
  const result = (await SKILL_TOOLS.file_task.run(ctx, {
    tool: typeof body.taskTool === "string" ? body.taskTool : "custom",
    request,
  })) as { ok?: boolean; taskId?: string; error?: string };

  if (!result.ok) {
    controller.enqueue(sse({ error: result.error ?? "Couldn't file the task." }));
    return;
  }
  const emailed = await sendTaskEmail(ctx.env, {
    userEmail: ctx.userEmail,
    shopDomain: ctx.conn?.shop_domain ?? null,
    tool: typeof body.taskTool === "string" ? body.taskTool : "custom",
    request,
    taskId: result.taskId ?? null,
    origin: ctx.origin,
  });
  controller.enqueue(sse({ meta: { taskId: result.taskId, emailed } }));
  // Concierge work remains separate from direct, merchant-approved Shopify
  // actions. The emailed flag is internal plumbing and stays server-side.
  const confirmation =
    "Noted — I've logged this request. For supported product, collection, or discount work, ask me in chat and I'll prepare a Shopify approval card for you.";
  controller.enqueue(sse({ choices: [{ delta: { content: confirmation } }] }));
}

async function runAgentic(
  skill: SkillDef,
  ctx: ToolCtx,
  note: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  progress: (t: string) => void,
): Promise<void> {
  progress(skill.progressLabel);

  const digests: Record<string, unknown> = {};
  await Promise.all(
    skill.prefetch.map(async ({ tool, args }) => {
      digests[tool] = await SKILL_TOOLS[tool].run(ctx, args);
    }),
  );
  const failures = Object.values(digests).filter(
    (d) => d && typeof d === "object" && "error" in (d as Record<string, unknown>),
  );
  if (failures.length === skill.prefetch.length && skill.prefetch.length > 0) {
    const first = failures[0] as { error?: string };
    controller.enqueue(sse({ error: first.error ?? "Couldn't reach your store's data." }));
    return;
  }

  progress(skill.writingLabel ?? "Writing your report…");
  const shaped = skill.shape ? skill.shape(digests) : digests;
  const shop = ctx.conn?.shop_domain?.replace(".myshopify.com", "") ?? "your store";

  const grounding = skill.web
    ? 'The JSON digests in the user message describe the founder\'s REAL catalog, computed directly from the store\'s Admin API — use them to understand the niche and price points. Everything about the MARKET must come from live web searches you run now: put a source link next to every trend claim, price benchmark, and supplier. If a search didn\'t verify something, leave it out — never invent products, stats, or links. If a digest carries an "error" field, say plainly that that data source was unreachable and work with what you have.'
    : 'The JSON digests in the user message were computed directly from the store\'s Admin API — every number is real. Cite only products and numbers present in the digests; NEVER invent data. If a digest carries an "error" field, say plainly that that data source was unreachable and work with what you have.';

  const system = [
    `You are Evolution, the AI COO for the founder's connected Shopify store "${shop}". You just ran the "${skill.label}" skill.`,
    grounding,
    "Write GitHub-flavored markdown. Concrete, founder-to-founder, no fluff, no em dashes. Short paragraphs and bullet lists over walls of text.",
    skill.prompt.replaceAll("{shop}", shop),
  ].join("\n\n");

  const userMsg =
    `Store data digests:\n${JSON.stringify(shaped)}` +
    (note ? `\n\nThe founder added this focus note: ${JSON.stringify(note)}` : "");

  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.groqKey}` },
    body: JSON.stringify({
      model: skill.web
        ? ctx.env.groqResearchModel || RESEARCH_MODEL_DEFAULT
        : ctx.env.groqModel || CHAT_MODEL_DEFAULT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: skill.maxTokens,
      stream: true,
    }),
    // Stream can run long; connect is what matters. Research skills get a
    // bigger budget — the model runs real web searches before/while writing.
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS + (skill.web ? 165_000 : 45_000)),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    log("error", "skill", "groq_upstream", { skill: skill.label, status: upstream.status });
    // Research runs pull big search contexts through Groq; on tight token
    // windows that surfaces as 413/429. Say "retry" — not Groq's billing copy.
    if (skill.web && (upstream.status === 413 || upstream.status === 429)) {
      controller.enqueue(
        sse({ error: "Live research is at capacity this minute — give it about 60 seconds and run it again." }),
      );
      return;
    }
    controller.enqueue(sse({ error: `Report writer error (${upstream.status}). ${detail.slice(0, 120)}` }));
    return;
  }

  // Forward Groq's SSE bytes verbatim, minus its [DONE] (we emit our own).
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      controller.enqueue(enc.encode(`${trimmed}\n\n`));
    }
  }
}
