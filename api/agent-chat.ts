/**
 * /api/agent-chat — the store-aware agentic chat for signed-in founders.
 *
 * POST { messages } with the owner's Supabase bearer token. The model holds
 * the skill tools and calls them itself; streams the same SSE protocol as
 * /api/skill (progress events + OpenAI-shaped deltas). All real logic lives
 * in _agentChat.ts so the dev server (dev-api.ts) runs the identical engine.
 *
 * GET is a health probe: 204 = present (the client falls back to /api/chat
 * on 404/503 or any auth failure).
 */
import { runAgentChat, type AgentChatBody } from "./_agentChat";
import { skillEnvFromProcess } from "./_skills";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: AgentChatBody;
  try {
    body = (await req.json()) as AgentChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = new URL(req.url).origin;
  return runAgentChat(body, req.headers.get("authorization"), origin, skillEnvFromProcess());
}
