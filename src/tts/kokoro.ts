/**
 * Kokoro text-to-speech — 100% in-browser, Apache-2.0.
 *
 * The model (onnx-community/Kokoro-82M-v1.0-ONNX) downloads once from the
 * Hugging Face CDN and is cached by the browser (IndexedDB/Cache API, handled
 * inside transformers.js). After that it runs offline on the shopper's own
 * device — WebGPU if available, else WASM. Nothing we pay for touches this.
 *
 * ALL loading and synthesis runs in a dedicated Web Worker (kokoro.worker.ts)
 * so ONNX inference never competes with the 3D avatar for the main thread.
 * This file is the main-thread bridge: it manages speaking sessions over the
 * worker protocol and pipes returned PCM chunks into the shared speechEngine,
 * which plays them gaplessly and exposes amplitude for lip-sync.
 */
import { speechEngine } from "../audio/speechEngine";
import type { KokoroDtype, WorkerToMain } from "./kokoroProtocol";

export const DEFAULT_VOICE = "af_heart";

/**
 * Settings now store Orpheus persona ids (the server voices); map each to the
 * closest local Kokoro voice so the offline fallback stays in character.
 * Kokoro ids pass through untouched (old persisted settings).
 */
const ORPHEUS_TO_KOKORO: Record<string, string> = {
  autumn: "af_heart",
  diana: "af_bella",
  hannah: "af_nicole",
  austin: "am_michael",
  daniel: "bm_george",
  troy: "am_puck",
};

function toKokoroVoice(voice?: string): string {
  if (!voice) return DEFAULT_VOICE;
  return ORPHEUS_TO_KOKORO[voice] ?? voice;
}

export interface ModelProgress {
  /** 0..1 overall download progress, or null while indeterminate. */
  progress: number | null;
  label: string;
}

export interface SpeakOptions {
  voice?: string;
  signal?: AbortSignal;
  /** Fired the moment the first audio chunk is queued (so the UI can react). */
  onFirstAudio?: () => void;
}

/**
 * A live text-to-speech session. `push` text fragments as they arrive (e.g.
 * LLM stream deltas); synthesis and playback overlap with generation. Call
 * `finish` after the last fragment — it resolves when playback ends.
 */
export interface StreamingSpeaker {
  push(text: string): void;
  finish(): Promise<void>;
  cancel(): void;
}

/** Perf experiments: localStorage.setItem("evolution-tts-dtype", "fp16") etc. */
const DTYPE_KEY = "evolution-tts-dtype";

function readDtypeOverride(): KokoroDtype | undefined {
  try {
    const v = localStorage.getItem(DTYPE_KEY);
    if (v === "fp32" || v === "fp16" || v === "q8" || v === "q4" || v === "q4f16") return v;
  } catch {
    /* storage unavailable */
  }
  return undefined;
}

interface SessionHooks {
  onChunk(samples: Float32Array, sampleRate: number): void;
  onDone(): void;
  onError(err: Error): void;
}

let workerHandle: { worker: Worker; ready: Promise<void> } | null = null;
let sessionCounter = 0;
const sessions = new Map<number, SessionHooks>();
let progressCb: ((p: ModelProgress) => void) | null = null;

function getWorker(): { worker: Worker; ready: Promise<void> } {
  if (workerHandle) return workerHandle;

  const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A failed load (e.g. offline first visit) may be retried later: drop the
  // handle so the next call spins up a fresh worker.
  ready.catch(() => {
    if (workerHandle?.worker === worker) workerHandle = null;
    worker.terminate();
  });

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as WorkerToMain;
    switch (msg.type) {
      case "progress":
        progressCb?.({ progress: msg.progress, label: msg.label });
        break;
      case "ready":
        console.info(`[tts] Kokoro ready (${msg.device}, ${msg.dtype})`);
        resolveReady();
        break;
      case "load-error":
        rejectReady(new Error(msg.message));
        break;
      case "chunk":
        sessions.get(msg.id)?.onChunk(msg.samples, msg.sampleRate);
        break;
      case "done":
        sessions.get(msg.id)?.onDone();
        break;
      case "error":
        sessions.get(msg.id)?.onError(new Error(msg.message));
        break;
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "TTS worker crashed");
    rejectReady(err);
    for (const s of [...sessions.values()]) s.onError(err);
    sessions.clear();
  };

  // Start the model load immediately (no voice → no priming yet); this also
  // guarantees the dtype override is what the cached load promise uses, even
  // if a speak session beats warmUpKokoro to the worker.
  worker.postMessage({ type: "load", dtype: readDtypeOverride() });
  workerHandle = { worker, ready };
  return workerHandle;
}

/**
 * Kick off the model load early (e.g. right after first paint) to hide
 * latency. Pass the user's voice so the worker can prime it — a tiny
 * discarded synthesis that pre-fetches the voice embedding and JITs the
 * inference path, making the first real turn as fast as every other.
 */
export function warmUpKokoro(onProgress?: (p: ModelProgress) => void, voice?: string): void {
  if (onProgress) progressCb = onProgress;
  const { worker, ready } = getWorker();
  worker.postMessage({ type: "load", dtype: readDtypeOverride(), voice: toKokoroVoice(voice) });
  void ready.catch(() => {
    /* surfaced to the user elsewhere; nothing to do here */
  });
}

/**
 * Open a Kokoro speaking session. Fragments pushed before the model finishes
 * loading are buffered (in the worker), then flushed into the sentence
 * splitter — so callers can start pushing immediately and the first sentence
 * synthesizes the moment the model is ready.
 */
export function createKokoroSpeaker(opts: SpeakOptions = {}): StreamingSpeaker {
  const { signal, onFirstAudio } = opts;
  const voice = toKokoroVoice(opts.voice);
  const { worker, ready } = getWorker();
  const id = ++sessionCounter;

  let first = true;
  let cancelled = false;
  let settle!: { resolve: () => void; reject: (err: Error) => void };
  const done = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Callers may cancel without awaiting finish(); don't surface as unhandled.
  done.catch(() => undefined);

  sessions.set(id, {
    onChunk: (samples, sampleRate) => {
      if (cancelled || signal?.aborted) return;
      if (first) {
        first = false;
        onFirstAudio?.();
      }
      speechEngine.enqueue(samples, sampleRate);
    },
    onDone: () => {
      sessions.delete(id);
      settle.resolve();
    },
    onError: (err) => {
      sessions.delete(id);
      settle.reject(err);
    },
  });

  // Unlock is a no-op when already unlocked; calling here keeps it inside the
  // user-gesture call stack for the very first turn.
  void speechEngine.unlock();
  speechEngine.setProcedural(false);

  worker.postMessage({ type: "speak-start", id, voice });
  // If the model never loads, fail this session so the caller can fall back.
  void ready.catch((err: unknown) => {
    sessions.get(id)?.onError(err instanceof Error ? err : new Error(String(err)));
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    worker.postMessage({ type: "cancel", id });
    sessions.delete(id);
    settle.resolve();
  };
  signal?.addEventListener("abort", cancel, { once: true });

  return {
    push(text: string): void {
      if (cancelled || !text) return;
      worker.postMessage({ type: "push", id, text });
    },
    async finish(): Promise<void> {
      worker.postMessage({ type: "close", id });
      await done;
      await speechEngine.waitUntilDone(signal);
    },
    cancel,
  };
}

/**
 * Speak `text` with Kokoro, streaming chunks into the audio engine.
 * Resolves once playback has fully finished.
 */
export async function speakWithKokoro(text: string, opts: SpeakOptions = {}): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const speaker = createKokoroSpeaker(opts);
  speaker.push(clean);
  await speaker.finish();
}
