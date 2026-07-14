/**
 * Kokoro text-to-speech — 100% in-browser, Apache-2.0.
 *
 * The model (onnx-community/Kokoro-82M-v1.0-ONNX) downloads once from the
 * Hugging Face CDN and is cached by the browser (IndexedDB/Cache API, handled
 * inside transformers.js). After that it runs offline on the shopper's own
 * device — WebGPU if available, else WASM. Nothing we pay for touches this.
 *
 * We use the STREAMING API so audio starts playing before the whole sentence is
 * synthesised, and pipe each chunk straight into the shared speechEngine, which
 * both plays it and exposes an amplitude for lip-sync.
 */
import { speechEngine } from "../audio/speechEngine";
import { hasWebGPU } from "../lib/capabilities";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** A friendly, curated subset of Kokoro's voices. Full list is much larger. */
export const VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart (US, warm)" },
  { id: "af_bella", label: "Bella (US)" },
  { id: "af_nicole", label: "Nicole (US, soft)" },
  { id: "af_sky", label: "Sky (US)" },
  { id: "am_michael", label: "Michael (US, male)" },
  { id: "am_puck", label: "Puck (US, male)" },
  { id: "bf_emma", label: "Emma (UK)" },
  { id: "bm_george", label: "George (UK, male)" },
];

export const DEFAULT_VOICE = "af_heart";

export interface ModelProgress {
  /** 0..1 overall download progress, or null while indeterminate. */
  progress: number | null;
  label: string;
}

// kokoro-js is loaded lazily (dynamic import) so its ~large dependency graph and
// the model download only happen the first time the user actually asks for voice.
type KokoroModule = typeof import("kokoro-js");
type KokoroTTS = InstanceType<KokoroModule["KokoroTTS"]>;

let ttsPromise: Promise<KokoroTTS> | null = null;

/** Track per-file download progress to compute a single overall percentage. */
function makeProgressAggregator(onProgress?: (p: ModelProgress) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: unknown) => {
    if (!onProgress) return;
    const e = event as {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
    };
    if (e.status === "progress" && e.file && typeof e.total === "number" && e.total > 0) {
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
    }
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    onProgress({
      progress: total > 0 ? Math.min(1, loaded / total) : null,
      label: e.status === "ready" ? "Ready" : "Warming up the voice…",
    });
  };
}

/** Load (and cache the promise for) the Kokoro model. */
export async function loadKokoro(onProgress?: (p: ModelProgress) => void): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const device: "webgpu" | "wasm" = (await hasWebGPU()) ? "webgpu" : "wasm";
      // fp32 on WebGPU for quality; q8 on WASM to keep the download & CPU cost low.
      const dtype = device === "webgpu" ? "fp32" : "q8";
      return KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: makeProgressAggregator(onProgress),
      });
    })();
    // If loading fails, clear the cache so a later attempt can retry.
    ttsPromise.catch(() => {
      ttsPromise = null;
    });
  }
  return ttsPromise;
}

/** Kick off the download early (e.g. right after first paint) to hide latency. */
export function warmUpKokoro(onProgress?: (p: ModelProgress) => void): void {
  void loadKokoro(onProgress).catch(() => {
    /* surfaced to the user elsewhere; nothing to do here */
  });
}

export interface SpeakOptions {
  voice?: string;
  signal?: AbortSignal;
  /** Fired the moment the first audio chunk is queued (so the UI can react). */
  onFirstAudio?: () => void;
}

/**
 * Speak `text` with Kokoro, streaming chunks into the audio engine.
 * Resolves once playback has fully finished.
 */
export async function speakWithKokoro(text: string, opts: SpeakOptions = {}): Promise<void> {
  const { voice = DEFAULT_VOICE, signal, onFirstAudio } = opts;
  const clean = text.trim();
  if (!clean) return;

  const tts = await loadKokoro();
  await speechEngine.unlock();
  speechEngine.setProcedural(false);

  const { TextSplitterStream } = await import("kokoro-js");
  const splitter = new TextSplitterStream();
  // Kokoro types `voice` as a union of literal ids; our settings hold a string.
  const streamOptions = { voice } as Parameters<KokoroTTS["stream"]>[1];
  const stream = tts.stream(splitter, streamOptions);

  let first = true;
  // Consume generated audio as it arrives.
  const consume = (async () => {
    for await (const chunk of stream as AsyncIterable<{
      audio: { audio: Float32Array; sampling_rate: number };
    }>) {
      if (signal?.aborted) break;
      if (first) {
        first = false;
        onFirstAudio?.();
      }
      speechEngine.enqueue(chunk.audio.audio, chunk.audio.sampling_rate);
    }
  })();

  // Feed the text token-by-token so the splitter can emit sentences early.
  const tokens = clean.match(/\s*\S+/g) ?? [clean];
  for (const token of tokens) {
    if (signal?.aborted) break;
    splitter.push(token);
  }
  splitter.close();

  await consume;
  await speechEngine.waitUntilDone(signal);
}
