/**
 * /api/chat — streaming LLM proxy.
 *
 * The browser never sees the Groq key: it lives in the GROQ_API_KEY env var
 * (Vercel project settings; plain — NOT VITE_-prefixed, which would bake it
 * into the public bundle). The client sends OpenAI-shaped messages; we
 * forward to Groq with stream:true and pipe the SSE body straight back.
 *
 * POST requires the caller's Supabase bearer (every production caller sits
 * behind AuthGate). On a demo deployment with no Supabase configured the
 * route stays open — that build has no login gate at all.
 *
 * GET is a health probe: 204 = configured, 503 = key missing.
 */
import {
  GROQ_BASE,
  CHAT_MODEL_DEFAULT,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOTAL_CHARS,
  CHAT_MAX_COMPLETION_TOKENS,
} from "./_shared";
import { requireUser, sameOriginOk } from "./_auth";
import { checkRateLimit } from "./_ratelimit";
import { routeLogger } from "./_log";

export const config = { runtime: "edge" };

/** 600 completion tokens finish far sooner; this caps stalls and runaways. */
export const CHAT_UPSTREAM_TIMEOUT_MS = 55_000;
export const CHAT_LIMIT_PER_HOUR = 120;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ROLES = new Set(["system", "user", "assistant"]);

export default async function handler(req: Request): Promise<Response> {
  const key = (process.env.GROQ_API_KEY ?? "").trim();

  if (req.method === "GET") {
    return new Response(null, { status: key ? 204 : 503 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!key) {
    return new Response("LLM proxy not configured (missing GROQ_API_KEY).", { status: 503 });
  }

  const logger = routeLogger("chat");
  if (!sameOriginOk(req)) {
    logger.warn("cross_origin_blocked", {});
    return new Response("Forbidden.", { status: 403 });
  }

  const authEnv = {
    supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  };
  const auth = await requireUser(req.headers.get("authorization"), authEnv);
  if (!auth.ok) {
    logger.warn("unauthorized", {});
    return new Response("Sign in to use the assistant.", { status: 401 });
  }
  if (auth.userId && !(await checkRateLimit(authEnv, `chat:u:${auth.userId}`, 3_600, CHAT_LIMIT_PER_HOUR))) {
    logger.warn("rate_limited", { userId: auth.userId });
    return new Response("You're sending messages very fast — give it a minute and try again.", {
      status: 429,
    });
  }

  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
    messages = body.messages as ChatMessage[];
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (messages.length === 0 || messages.length > CHAT_MAX_MESSAGES) {
    return new Response("Too many messages.", { status: 400 });
  }
  let totalChars = 0;
  for (const m of messages) {
    if (!m || !ROLES.has(m.role) || typeof m.content !== "string") {
      return new Response("Malformed message.", { status: 400 });
    }
    totalChars += m.content.length;
  }
  if (totalChars > CHAT_MAX_TOTAL_CHARS) {
    return new Response("Conversation too large.", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: (process.env.GROQ_CHAT_MODEL ?? "").trim() || CHAT_MODEL_DEFAULT,
        messages,
        temperature: 0.7,
        max_tokens: CHAT_MAX_COMPLETION_TOKENS,
        stream: true,
      }),
      signal: AbortSignal.timeout(CHAT_UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    logger.error("groq_upstream", { reason: "timeout_or_network" });
    return new Response("The assistant took too long to answer — try again.", { status: 504 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    logger.error("groq_upstream", { status: upstream.status });
    return new Response(`Upstream LLM error (${upstream.status}). ${detail.slice(0, 200)}`, {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-store",
    },
  });
}
