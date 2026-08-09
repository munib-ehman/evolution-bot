/**
 * Client for POST /api/agent-chat — the store-aware agentic chat.
 *
 * Separate from client.ts (whose exact behavior is load-bearing for the
 * voice loop) and from skillClient.ts (whose result shape is a skill report).
 * The stream protocol matches the skills': {"progress"} status events plus
 * OpenAI-shaped {"choices":[{"delta":…}]} content, ending with [DONE].
 *
 * useAssistant tries this path for signed-in founders with a connected store
 * and falls back to the generic /api/chat brain when it throws before any
 * content streamed (missing session, endpoint absent, store not connected).
 */
import { supabase } from "../lib/auth";
import type { Message } from "../types";
import type { ShopifyActionProposal } from "../lib/actions";
import type { RecoveryCampaignProposal } from "../lib/recovery";

export class AgentChatError extends Error {
  constructor(
    public status: number,
    message: string,
    /** True when content already streamed — the caller must NOT fall back (it would double-answer). */
    public streamedSomething = false,
  ) {
    super(message);
  }
}

export interface AgentChatOptions {
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
  onToken?: (text: string) => void;
  onAction?: (action: ShopifyActionProposal) => void;
  onRecoveryProposal?: (proposal: RecoveryCampaignProposal) => void;
}

/** Server rebuilds the system prompt; send user/assistant turns only. */
const HISTORY_TURNS = 12;

export async function runAgentChat(history: Message[], opts: AgentChatOptions = {}): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (!headers.Authorization) throw new AgentChatError(401, "No session.");

  const messages = history
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch("/api/agent-chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ messages }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let message = `Agent chat failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep the generic message */
    }
    throw new AgentChatError(res.status, message);
  }
  if (!res.body) throw new AgentChatError(500, "The agent stream had no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (!reply) throw new AgentChatError(500, "The agent returned an empty reply.", false);
          return reply;
        }
        let json: {
          progress?: string;
          error?: string;
          choices?: { delta?: { content?: string } }[];
          action?: ShopifyActionProposal;
          recoveryProposal?: RecoveryCampaignProposal;
        };
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // keep-alives / malformed lines
        }
        if (typeof json.error === "string") {
          throw new AgentChatError(500, json.error, reply.length > 0);
        }
        if (typeof json.progress === "string") opts.onProgress?.(json.progress);
        if (json.action) opts.onAction?.(json.action);
        if (json.recoveryProposal) opts.onRecoveryProposal?.(json.recoveryProposal);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          reply += delta;
          opts.onToken?.(delta);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!reply) throw new AgentChatError(500, "The agent stream ended unexpectedly.");
  return reply;
}
