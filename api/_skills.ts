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
import { GROQ_BASE, CHAT_MODEL_DEFAULT } from "./_shared";
import { resolveUserFull } from "./_audit";
import { getConnection, shopifyEnvFromProcess } from "./_shopify";
import { SKILL_TOOLS, type SkillEnv, type ToolCtx } from "./_skillTools";
import { sendTaskEmail } from "./_email";

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
  prompt: string;
  maxTokens: number;
}

const ESCALATION_LINE =
  "End the report with exactly one short closing line inviting the founder to use the \"Ask the team to fix this\" action under the report if they want Evolution's team to do the work.";

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
  cart_recovery: {
    id: "cart_recovery",
    label: "Cart recovery report",
    kind: "agentic",
    progressLabel: "Pulling your abandoned checkouts…",
    prefetch: [
      { tool: "get_abandoned_checkouts", args: { days: 30 } },
      { tool: "get_orders_summary", args: { days: 30 } },
    ],
    prompt: `Write an abandoned-cart recovery report. Structure: "## Cart recovery — {shop}" then a summary contrasting completed revenue vs abandoned value (30 days), then "### What's being left behind" (count, total and average value, how many left an email = recoverable), "### What a recovery flow would win back" (use the industry 5–15% recovery range applied to the real abandoned value — show the math), "### The 3-touch sequence we recommend" (timing: ~1h, ~24h, ~72h; one line each on the angle). ${ESCALATION_LINE}`,
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
    label: "Ask the team to fix this",
    kind: "concierge",
    progressLabel: "Filing this with the Evolution team…",
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
  const confirmation = emailed
    ? "Done — this is filed with the Evolution team and they've been emailed. Track it in your Tasks panel; the result will show up right here in chat when it's handled."
    : "Done — this is filed with the Evolution team. Track it in your Tasks panel; the result will show up right here in chat when it's handled.";
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

  progress("Writing your report…");
  const shaped = skill.shape ? skill.shape(digests) : digests;
  const shop = ctx.conn?.shop_domain?.replace(".myshopify.com", "") ?? "your store";

  const system = [
    `You are Evolution, the AI COO for the founder's connected Shopify store "${shop}". You just ran the "${skill.label}" skill.`,
    "The JSON digests in the user message were computed directly from the store's Admin API — every number is real. Cite only products and numbers present in the digests; NEVER invent data. If a digest carries an \"error\" field, say plainly that that data source was unreachable and work with what you have.",
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
      model: ctx.env.groqModel || CHAT_MODEL_DEFAULT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: skill.maxTokens,
      stream: true,
    }),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS + 45_000), // stream can run long; connect is what matters
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
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
