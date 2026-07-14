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
import { llmConfig, isMockMode } from "./config";
import { SYSTEM_PROMPT, buildProductContext } from "./systemPrompt";
import { retrieveRelevant, formatProducts } from "./retrieval";
import { mockReply } from "./mock";

export { isMockMode };

interface ChatOptions {
  signal?: AbortSignal;
}

/**
 * Get the assistant's reply to the latest user message, given prior turns and
 * the product catalog. Returns plain text (ready to be spoken).
 */
export async function getAssistantReply(
  history: Message[],
  products: Product[],
  options: ChatOptions = {},
): Promise<string> {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const query = lastUser?.content ?? "";

  if (isMockMode) {
    // Tiny artificial delay so the "thinking" state is visible and it feels alive.
    await new Promise((r) => setTimeout(r, 250));
    return mockReply(query, products);
  }

  const relevant = retrieveRelevant(query, products, 5);
  const systemContent = SYSTEM_PROMPT + buildProductContext(formatProducts(relevant));

  const apiMessages = [
    { role: "system" as const, content: systemContent },
    // Keep the last few turns for continuity without blowing the context.
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
  ];

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
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM returned an empty response.");
  return content;
}
