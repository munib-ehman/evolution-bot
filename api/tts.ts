/**
 * /api/tts — text-to-speech proxy (Groq-hosted Orpheus).
 *
 * POST { text, voice? } → audio/wav bytes. Voice may be a Kokoro id (the
 * app's settings) or an Orpheus persona; _shared.ts maps it. Orpheus caps
 * input at 200 chars — the client splits sentences to fit, we reject over.
 *
 * GET is a health probe: 204 = configured, 503 = key missing.
 */
import { GROQ_BASE, TTS_MODEL_DEFAULT, TTS_MAX_CHARS, mapVoice } from "./_shared";

export const config = { runtime: "edge" };

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

  const upstream = await fetch(`${GROQ_BASE}/audio/speech`, {
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
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
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
