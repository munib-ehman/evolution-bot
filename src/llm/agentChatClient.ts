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
import type { WinbackCampaignProposal } from "../lib/winbackCampaigns";
import type { BroadcastCampaign } from "../lib/broadcastCampaigns";

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
  manager?: "marketing" | "customer-success" | "seo" | "product";
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
  onToken?: (text: string) => void;
  onAction?: (action: ShopifyActionProposal) => void;
  onRecoveryProposal?: (proposal: RecoveryCampaignProposal) => void;
  onWinbackProposal?: (proposal: WinbackCampaignProposal) => void;
  onBroadcastProposal?: (proposal: BroadcastCampaign) => void;
}

/** Server rebuilds the system prompt; send user/assistant turns only. */
const HISTORY_TURNS = 16;

async function sessionToken(refresh = false): Promise<string | null> {
  if (!supabase) return null;
  const result = refresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  if (result.error) return null;
  return result.data.session?.access_token ?? null;
}

async function postAgentChat(
  body: string,
  signal: AbortSignal | undefined,
  refresh = false,
): Promise<Response> {
  const token = await sessionToken(refresh);
  if (!token) throw new AgentChatError(401, "Your session expired. Please sign in again.");
  return fetch("/api/agent-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
    signal,
  });
}

export async function runAgentChat(history: Message[], opts: AgentChatOptions = {}): Promise<string> {
  const messages = history
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));
  const body = JSON.stringify({ messages, manager: opts.manager });

  // The workspace can remain open beyond the access-token lifetime. If the
  // API rejects the cached token, refresh it and replay this same user turn
  // once so their carefully entered answer is not lost.
  let res = await postAgentChat(body, opts.signal);
  if (res.status === 401) res = await postAgentChat(body, opts.signal, true);

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
          winbackProposal?: WinbackCampaignProposal;
          broadcastProposal?: BroadcastCampaign;
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
        if (json.winbackProposal) opts.onWinbackProposal?.(json.winbackProposal);
        if (json.broadcastProposal) opts.onBroadcastProposal?.(json.broadcastProposal);
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
