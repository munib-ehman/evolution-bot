/**
 * /api/chat — streaming LLM proxy.
 *
 * The browser never sees the Groq key: it lives in the GROQ_API_KEY env var
 * (Vercel project settings; plain — NOT VITE_-prefixed, which would bake it
 * into the public bundle). The client sends OpenAI-shaped messages; we
 * forward to Groq with stream:true and pipe the SSE body straight back.
 *
 * GET is a health probe: 204 = configured, 503 = key missing.
 */
import { GROQ_BASE, CHAT_MODEL_DEFAULT, CHAT_MAX_MESSAGES, CHAT_MAX_TOTAL_CHARS } from "./_shared";

export const config = { runtime: "edge" };

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

  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: (process.env.GROQ_CHAT_MODEL ?? "").trim() || CHAT_MODEL_DEFAULT,
      messages,
      temperature: 0.7,
      max_tokens: 220,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
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
