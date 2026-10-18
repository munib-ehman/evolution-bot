/**
 * The assistant's brain. Two paths, both selected automatically:
 *
 *  1. MOCK MODE (default, no key)  → rule-based answers from products.json. $0.
 *  2. REAL MODE (env key present)  → one POST to an OpenAI-compatible chat API
 *     (Groq / OpenRouter / Gemini / local Ollama). We inject the system prompt
 *     plus a handful of keyword-retrieved products as context. The key comes
 *     only from `.env` — never hardcoded.
 *
 * This is the ONLY part of the app that may touch an external service, and even
 * then it's designed around free tiers (or a fully-local server).
 */
import type { Message, Product } from "../types";
import { supabase } from "../lib/auth";
import { llmConfig, isMockMode } from "./config";
import { SYSTEM_PROMPT, buildProductContext } from "./systemPrompt";
import { retrieveRelevant, formatProducts } from "./retrieval";
import { mockReply } from "./mock";

export { isMockMode };

interface ChatOptions {
  /** Cofounder conversations use the same authenticated proxy, without catalog or mock fallbacks. */
  systemPrompt?: string;
  requireProxy?: boolean;
  signal?: AbortSignal;
  /**
   * Fired for each streamed text fragment as it arrives, so the caller can
   * start TTS and paint the reply while the model is still writing. When the
   * provider can't stream (or in mock mode) it fires exactly once with the
   * whole reply — downstream code never has to care which happened.
   */
  onToken?: (text: string) => void;
  /**
   * Connected-store context (store URL + audit findings). When present it
   * REPLACES the demo-catalog block, so the copilot talks about the
   * founder's real store instead of sample products.
   */
  extraContext?: string;
}

/**
 * Get the assistant's reply to the latest user message, given prior turns and
 * the product catalog. Streams fragments via `onToken` and resolves with the
 * full text once generation is complete.
 */
// Whether /api/chat exists and is configured — probed on first use so the
// same build works with or without the backend deployed.
let chatProxyUsable: boolean | null = null;

export async function getAssistantReply(
  history: Message[],
  products: Product[],
  options: ChatOptions = {},
): Promise<string> {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const query = lastUser?.content ?? "";

  const systemContent = options.systemPrompt ?? (options.extraContext
    ? SYSTEM_PROMPT + options.extraContext
    : SYSTEM_PROMPT + buildProductContext(formatProducts(retrieveRelevant(query, products, 5))));

  const apiMessages = [
    { role: "system" as const, content: systemContent },
    // Keep the last few turns for continuity without blowing the context.
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
  ];

  // Preferred path: our /api/chat proxy (key stays server-side). Falls back
  // to a direct provider call if VITE_LLM_* vars are configured, then to the
  // built-in mock brain so the product always answers.
  if (options.requireProxy || chatProxyUsable !== false) {
    try {
      return await proxyReply(apiMessages, options);
    } catch (err) {
      if (options.signal?.aborted || options.requireProxy) throw err;
      console.warn("[llm] /api/chat failed, falling back:", err);
    }
  }

  if (options.requireProxy) throw new Error("AI chat is not available yet. Your idea is saved here; please try again later.");
  if (!isMockMode) return directReply(apiMessages, options);

  // Mock mode: tiny artificial delay so the "thinking" state is visible.
  await new Promise((r) => setTimeout(r, 250));
  const reply = mockReply(query, products);
  options.onToken?.(reply);
  return reply;
}

type ApiMessage = { role: "system" | "user" | "assistant"; content: string };

/** The signed-in user's access token, when auth is configured. */
async function sessionToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Call our serverless proxy; throws (and remembers) when it isn't deployed. */
async function proxyReply(apiMessages: ApiMessage[], options: ChatOptions): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await sessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: apiMessages }),
    signal: options.signal,
  });

  // 404/405 = not deployed (static host), 503 = deployed but no key. Remember
  // so later turns skip the probe entirely. 401/429 are transient (signed
  // out / sending too fast) — throw without marking the proxy unusable.
  if (res.status === 404 || res.status === 405 || res.status === 503) {
    chatProxyUsable = false;
    throw new Error(`LLM proxy unavailable (${res.status}).`);
  }
  if (res.status === 429) {
    throw new Error("You're sending messages very fast — give it a minute and try again.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}). ${detail.slice(0, 200)}`);
  }
  chatProxyUsable = true;
  return finishReply(res, options);
}

/** Direct provider call (VITE_LLM_* env vars — dev convenience/self-hosted). */
async function directReply(apiMessages: ApiMessage[], options: ChatOptions): Promise<string> {
  const url = `${llmConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model || "gpt-3.5-turbo",
      messages: apiMessages,
      temperature: 0.7,
      max_tokens: 220,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}). ${detail.slice(0, 200)}`);
  }
  return finishReply(res, options);
}

/**
 * Consume a successful chat response. Providers that honour `stream: true`
 * reply with SSE; a few ignore it and send plain JSON. Support both so a
 * misbehaving provider degrades to buffered behaviour instead of breaking.
 */
async function finishReply(res: Response, options: ChatOptions): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("LLM returned an empty response.");
    options.onToken?.(content);
    return content;
  }

  const full = await readSseStream(res, options);
  const content = full.trim();
  if (!content) throw new Error("LLM returned an empty response.");
  return content;
}

/** Parse an OpenAI-style SSE body, firing onToken per content delta. */
async function readSseStream(res: Response, options: ChatOptions): Promise<string> {
  if (!res.body) throw new Error("LLM response had no body to stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines; each data line is one JSON chunk.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the trailing partial line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return full;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            options.onToken?.(delta);
          }
        } catch {
          // Ignore malformed keep-alive/comment lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}
