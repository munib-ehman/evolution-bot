/**
 * /api/tts — text-to-speech proxy (Groq-hosted Orpheus).
 *
 * POST { text, voice? } → audio/wav bytes. Voice may be a Kokoro id (the
 * app's settings) or an Orpheus persona; _shared.ts maps it. Orpheus caps
 * input at 200 chars — the client splits sentences to fit, we reject over.
 *
 * POST requires the caller's Supabase bearer (fires once per sentence, so
 * auth resolution is cached in _auth.ts). No DB rate limit here: auth plus
 * the 200-char cap bound the cost, and a per-sentence DB round trip would
 * add latency to the voice pipeline. On a demo deployment with no Supabase
 * configured the route stays open — that build has no login gate at all.
 *
 * GET is a health probe: 204 = configured, 503 = key missing.
 */
import { GROQ_BASE, TTS_MODEL_DEFAULT, TTS_MAX_CHARS, mapVoice } from "./_shared";
import { requireUser, sameOriginOk } from "./_auth";
import { routeLogger } from "./_log";

export const config = { runtime: "edge" };

export const TTS_UPSTREAM_TIMEOUT_MS = 30_000;

export default async function handler(req: Request): Promise<Response> {
  const key = (process.env.GROQ_API_KEY ?? "").trim();

  if (req.method === "GET") {
    return new Response(null, { status: key ? 204 : 503 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!key) {
    return new Response("TTS proxy not configured (missing GROQ_API_KEY).", { status: 503 });
  }

  const logger = routeLogger("tts");
  if (!sameOriginOk(req)) {
    logger.warn("cross_origin_blocked", {});
    return new Response("Forbidden.", { status: 403 });
  }

  const auth = await requireUser(req.headers.get("authorization"), {
    supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  });
  if (!auth.ok) {
    logger.warn("unauthorized", {});
    return new Response("Sign in to use voice.", { status: 401 });
  }

  let text: string;
  let voice: string | undefined;
  try {
    const body = (await req.json()) as { text?: unknown; voice?: unknown };
    if (typeof body.text !== "string") throw new Error("text required");
    text = body.text.trim();
    voice = typeof body.voice === "string" ? body.voice : undefined;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (!text) return new Response("Empty text.", { status: 400 });
  if (text.length > TTS_MAX_CHARS) {
    return new Response(`Text too long (max ${TTS_MAX_CHARS} chars).`, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${GROQ_BASE}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: (process.env.GROQ_TTS_MODEL ?? "").trim() || TTS_MODEL_DEFAULT,
        voice: mapVoice(voice),
        input: text,
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(TTS_UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    logger.error("groq_upstream", { reason: "timeout_or_network" });
    return new Response("Voice synthesis took too long — try again.", { status: 504 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    logger.error("groq_upstream", { status: upstream.status });
    return new Response(`Upstream TTS error (${upstream.status}). ${detail.slice(0, 200)}`, {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
