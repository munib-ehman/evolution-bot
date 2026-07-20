/**
 * /api/skill — authenticated agentic skill runs on the connected store.
 *
 * POST { skillId, note?, taskTool? } with the owner's Supabase bearer token.
 * Streams SSE: progress events, then the markdown report as OpenAI-shaped
 * deltas (or a task confirmation for concierge skills). All real logic lives
 * in _skills.ts so the dev server (dev-api.ts) runs the identical engine.
 *
 * GET is a health probe: 204 = configured.
 */
import { runSkill, skillEnvFromProcess, type SkillRunBody } from "./_skills";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: SkillRunBody;
  try {
    body = (await req.json()) as SkillRunBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = new URL(req.url).origin;
  return runSkill(body, req.headers.get("authorization"), origin, skillEnvFromProcess());
}
