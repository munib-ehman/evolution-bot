/**
 * Unified TTS entry point with a quality-first engine chain:
 *
 *   1. SERVER (/api/tts, Groq Orpheus) — fast server GPUs, whole natural
 *      sentences, no downloads. Primary whenever the backend is deployed.
 *   2. KOKORO (in-browser, Web Worker) — free/offline fallback when there is
 *      no backend. Quality depends on the device.
 *   3. BROWSER (SpeechSynthesis) — last-resort so the avatar always talks.
 *
 * All engines feed the same speechEngine, so playback, barge-in, and avatar
 * lip-sync behave identically regardless of where the audio came from.
 */
import type { TtsEngine } from "../types";
import { speechEngine } from "../audio/speechEngine";
import {
  speakWithKokoro,
  createKokoroSpeaker,
  warmUpKokoro,
  type SpeakOptions,
  type StreamingSpeaker,
  type ModelProgress,
} from "./kokoro";
import { createServerSpeaker, serverTtsAvailable, warmUpServerTts } from "./serverTts";
import { speakWithBrowser, browserTtsAvailable } from "./browserTts";

export type { ModelProgress, SpeakOptions, StreamingSpeaker } from "./kokoro";

/**
 * User-facing voice list — the Orpheus personas served by /api/tts (the
 * primary engine). When the app runs without a backend, the Kokoro fallback
 * maps each persona to its closest local voice (see kokoro.ts), and old
 * persisted Kokoro voice ids still work via the server-side map — so this
 * one list is valid whichever engine ends up speaking.
 */
export const VOICES: { id: string; label: string }[] = [
  { id: "autumn", label: "Autumn (US, warm)" },
  { id: "diana", label: "Diana (US)" },
  { id: "hannah", label: "Hannah (US, soft)" },
  { id: "austin", label: "Austin (US, male)" },
  { id: "daniel", label: "Daniel (male)" },
  { id: "troy", label: "Troy (male)" },
];

export const DEFAULT_VOICE = "autumn";

const NOOP_SPEAKER: StreamingSpeaker = {
  push: () => undefined,
  finish: async () => undefined,
  cancel: () => undefined,
};

/**
 * Warm up whichever voice engine this visitor will actually use: probe the
 * backend, and only if it's absent start the (heavy) Kokoro download.
 */
export function warmUpVoice(onProgress?: (p: ModelProgress) => void, voice?: string): void {
  void serverTtsAvailable().then((serverOk) => {
    if (serverOk) {
      void warmUpServerTts(voice);
    } else {
      warmUpKokoro(onProgress, voice);
    }
  });
}

/**
 * Open a speaking session for the configured engine. Push text fragments as
 * they stream from the LLM; audio overlaps generation. The browser engine
 * can't consume partial text, so it buffers and speaks on finish.
 */
export function createSpeaker(engine: TtsEngine, opts: SpeakOptions = {}): StreamingSpeaker {
  if (engine === "off") return NOOP_SPEAKER;

  if (engine === "browser") {
    let text = "";
    let cancelled = false;
    return {
      push: (t) => {
        text += t;
      },
      finish: async () => {
        if (!cancelled && text.trim()) await speakWithBrowser(text, opts);
      },
      cancel: () => {
        cancelled = true;
        if (browserTtsAvailable()) window.speechSynthesis.cancel();
      },
    };
  }

  // engine === "kokoro" (i.e. "high-quality voice"): server first, local
  // Kokoro when no backend, browser voice if the chosen engine errors out.
  let inner: StreamingSpeaker | null = null;
  const buffered: string[] = [];
  let all = "";
  let cancelled = false;

  const innerReady = (async () => {
    const useServer = await serverTtsAvailable();
    const speaker = useServer ? createServerSpeaker(opts) : createKokoroSpeaker(opts);
    if (cancelled) {
      speaker.cancel();
      return speaker;
    }
    inner = speaker;
    for (const t of buffered) speaker.push(t);
    buffered.length = 0;
    return speaker;
  })();

  return {
    push(t: string): void {
      if (cancelled || !t) return;
      all += t;
      if (inner) inner.push(t);
      else buffered.push(t);
    },
    async finish(): Promise<void> {
      const speaker = await innerReady;
      try {
        await speaker.finish();
      } catch (err) {
        console.warn("[tts] voice engine failed, falling back to browser speech:", err);
        if (browserTtsAvailable() && !opts.signal?.aborted && !cancelled && all.trim()) {
          await speakWithBrowser(all, opts);
        }
      }
    },
    cancel(): void {
      cancelled = true;
      buffered.length = 0;
      if (inner) inner.cancel();
      else void innerReady.then((s) => s.cancel());
    },
  };
}

export async function speak(text: string, engine: TtsEngine, opts: SpeakOptions = {}): Promise<void> {
  if (engine === "off") return;

  if (engine === "browser") {
    return speakWithBrowser(text, opts);
  }

  try {
    if (await serverTtsAvailable()) {
      const speaker = createServerSpeaker(opts);
      speaker.push(text);
      await speaker.finish();
    } else {
      await speakWithKokoro(text, opts);
    }
  } catch (err) {
    console.warn("[tts] voice engine failed, falling back to browser speech:", err);
    if (browserTtsAvailable()) {
      await speakWithBrowser(text, opts);
    }
  }
}

/** Stop any in-progress speech immediately. */
export function stopSpeaking(): void {
  speechEngine.stop();
  if (browserTtsAvailable()) window.speechSynthesis.cancel();
}
