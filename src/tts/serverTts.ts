/**
 * Server text-to-speech via /api/tts (Groq-hosted Orpheus behind our proxy).
 *
 * This is the PRIMARY voice when the backend is deployed: synthesis runs many
 * times faster than realtime on server GPUs, so whole natural sentences play
 * with no mid-sentence chopping and no underrun gaps — the problems that made
 * in-browser synthesis feel broken on slower devices. Kokoro remains the
 * offline/fallback engine (see index.ts).
 *
 * Flow: LLM tokens stream in via push() → complete sentences are cut and
 * synthesized sequentially (each request returns in a few hundred ms while
 * the previous sentence is still playing) → WAV is decoded and fed to the
 * shared speechEngine, so playback and avatar lip-sync work exactly as with
 * the local engine.
 */
import { speechEngine } from "../audio/speechEngine";
import type { SpeakOptions, StreamingSpeaker } from "./kokoro";

/** Mirrors TTS_MAX_CHARS in api/_shared.ts (Orpheus's per-request cap). */
const MAX_CHARS = 200;

let availability: Promise<boolean> | null = null;

/** Probe /api/tts once per page load; 204 means deployed AND configured. */
export function serverTtsAvailable(): Promise<boolean> {
  if (!availability) {
    availability = (async () => {
      try {
        const res = await fetch("/api/tts", { method: "GET" });
        return res.status === 204;
      } catch {
        return false;
      }
    })();
  }
  return availability;
}

/**
 * Fire a tiny synthesis to warm the serverless function and the model, so
 * the first real turn doesn't pay the cold start.
 */
export async function warmUpServerTts(voice?: string): Promise<void> {
  try {
    await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hi!", voice }),
    });
  } catch {
    /* purely opportunistic */
  }
}

/** Pull complete sentences off the front of the buffer. */
function takeSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;
  for (;;) {
    // Sentence end = terminal punctuation (+ optional closing quote/bracket)
    // followed by whitespace. The lookahead keeps decimals ("3.5") and
    // "$1,250.50" intact.
    const m = rest.match(/^[\s\S]*?[.!?…]+["')\]]*(?=\s)/);
    if (!m) break;
    const s = m[0].trim();
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  return { sentences, rest };
}

/** Split anything over the API cap at word boundaries (rare, long sentences). */
function fitToCap(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const parts: string[] = [];
  let remaining = sentence;
  while (remaining.length > MAX_CHARS) {
    let cut = remaining.lastIndexOf(" ", MAX_CHARS);
    if (cut < MAX_CHARS / 2) cut = MAX_CHARS; // no usable space — hard cut
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function createServerSpeaker(opts: SpeakOptions = {}): StreamingSpeaker {
  const { voice, signal, onFirstAudio } = opts;

  let buf = "";
  const queue: string[] = [];
  let pumping = false;
  let cancelled = false;
  let closed = false;
  let first = true;
  let anyAudio = false;
  let error: Error | null = null;

  void speechEngine.unlock();
  speechEngine.setProcedural(false);

  const stopped = () => cancelled || !!signal?.aborted;

  // Sequential pump: order of enqueue() must match sentence order, and the
  // server is fast enough that sentence N+1 returns long before N finishes
  // playing — no parallelism needed.
  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0 && !stopped()) {
        const text = queue.shift()!;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
          signal,
        });
        if (!res.ok) throw new Error(`Server TTS failed (${res.status}).`);
        const data = await res.arrayBuffer();
        if (stopped()) return;
        const audio = await speechEngine.decode(data);
        if (stopped()) return;
        if (first) {
          first = false;
          onFirstAudio?.();
        }
        anyAudio = true;
        speechEngine.enqueue(audio.getChannelData(0), audio.sampleRate);
      }
    } catch (err) {
      if (!stopped()) {
        error = err instanceof Error ? err : new Error(String(err));
        queue.length = 0;
      }
    } finally {
      pumping = false;
    }
  };

  return {
    push(text: string): void {
      if (cancelled || closed || !text) return;
      buf += text;
      const { sentences, rest } = takeSentences(buf);
      buf = rest;
      if (sentences.length > 0) {
        queue.push(...sentences.flatMap(fitToCap));
        void pump();
      }
    },

    async finish(): Promise<void> {
      closed = true;
      const tail = buf.trim();
      buf = "";
      if (tail) queue.push(...fitToCap(tail));
      void pump();
      while ((queue.length > 0 || pumping) && !stopped()) {
        await new Promise((r) => setTimeout(r, 40));
      }
      // Nothing audible came out — let the caller fall back to another engine.
      if (error && !anyAudio) throw error;
      if (error) console.warn("[tts] server TTS failed mid-reply:", error);
      await speechEngine.waitUntilDone(signal);
    },

    cancel(): void {
      cancelled = true;
      queue.length = 0;
      buf = "";
    },
  };
}
