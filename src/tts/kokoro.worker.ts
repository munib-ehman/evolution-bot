/**
 * Kokoro TTS worker — all model loading and synthesis happens HERE, off the
 * main thread, so the ONNX inference never steals frames from the 3D avatar
 * or delays user input. The main thread (kokoro.ts) talks to this worker via
 * the small protocol in kokoroProtocol.ts and just plays the PCM it receives.
 */
import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import type { KokoroDtype, MainToWorker, WorkerToMain } from "./kokoroProtocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Minimal worker-scope typing without pulling the webworker lib into a DOM
// project (the two libs' global declarations collide).
type WorkerScope = {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};
const ctx = self as unknown as WorkerScope;

function post(message: WorkerToMain): void {
  ctx.postMessage(message);
}

/** WebGPU detection must run in THIS scope — workers have their own gpu. */
async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return "wasm";
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/** Track per-file download progress to compute a single overall percentage. */
function makeProgressAggregator() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: unknown) => {
    const e = event as { status?: string; file?: string; loaded?: number; total?: number };
    if (e.status === "progress" && e.file && typeof e.total === "number" && e.total > 0) {
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
    }
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({
      type: "progress",
      progress: total > 0 ? Math.min(1, loaded / total) : null,
      label: e.status === "ready" ? "Ready" : "Warming up the voice…",
    });
  };
}

let ttsPromise: Promise<KokoroTTS> | null = null;
let primed = false;

function loadModel(dtypeOverride?: KokoroDtype): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const device = await detectDevice();
      // fp32 on WebGPU for quality; q8 on WASM to keep the download & CPU cost
      // low. The override (localStorage "evolution-tts-dtype" on the main
      // thread) exists for benchmarking e.g. fp16/q4 without a code change.
      const dtype: KokoroDtype = dtypeOverride ?? (device === "webgpu" ? "fp32" : "q8");
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: makeProgressAggregator(),
      });
      post({ type: "ready", device, dtype });
      return tts;
    })();
    ttsPromise.catch((err) => {
      // Clear so a later attempt can retry (e.g. flaky network on first load).
      ttsPromise = null;
      post({ type: "load-error", message: err instanceof Error ? err.message : String(err) });
    });
  }
  return ttsPromise;
}

/**
 * One-time discarded synthesis right after load. This is what actually makes
 * the first real turn fast: it downloads the voice embedding (fetched lazily
 * on first generate, NOT with the model), initializes the phonemizer, and
 * lets the runtime JIT/compile the inference path.
 */
async function prime(tts: KokoroTTS, voice: string): Promise<void> {
  if (primed) return;
  primed = true;
  try {
    const t0 = performance.now();
    await tts.generate("Hi!", { voice } as Parameters<KokoroTTS["generate"]>[1]);
    console.debug(`[tts] primed voice "${voice}" in ${Math.round(performance.now() - t0)}ms`);
  } catch (err) {
    primed = false; // a real session may still succeed; allow re-prime attempts
    console.debug("[tts] priming failed (non-fatal):", err);
  }
}

/**
 * Segment-size ramp: Kokoro synthesizes one SEGMENT at a time and playback of
 * segment N overlaps synthesis of segment N+1. Two failure modes to avoid:
 *   - big first segment → long silence before ANY audio (synth of sentence 1)
 *   - tiny segments throughout → the next synth outlasts the short audio and
 *     playback underruns, heard as long breaks between sentences.
 * The fix is a RAMP: a tiny opener so sound starts immediately, then each
 * segment roughly doubles, so every segment's playback time covers the
 * synthesis of the one behind it even at ~1x realtime synthesis. After the
 * ramp, text passes through untouched and splits on natural sentences.
 *
 * (~15 chars ≈ 1s of speech, so 16/48/120 ≈ 1s, 3s, 8s of coverage.)
 */
const SEGMENT_CHAR_BUDGETS = [16, 48, 120];
const CUT_MIN = 2; // allow tiny openers ("Hey,", "So,") — ideal first segments

/**
 * Best cut for the current ramp budget: the LAST clause boundary within the
 * budget (biggest natural piece that fits); if none and the buffer overflows
 * the budget, the last word boundary; -1 to wait for more text.
 */
function findCut(buf: string, budget: number): number {
  const limit = Math.min(buf.length - 1, budget);
  let best = -1;
  for (let i = CUT_MIN; i < limit; i++) {
    const ch = buf[i];
    // Punctuation followed by whitespace — skips decimals ("3.5"), thousands
    // separators ("1,000"), URLs, and mid-word colons.
    if (",;:!?.…".includes(ch) && /\s/.test(buf[i + 1])) best = i + 1;
    else if (ch === "—") best = i + 1;
  }
  if (best > 0) return best;
  if (buf.length > budget) {
    const cut = buf.lastIndexOf(" ", budget);
    if (cut > CUT_MIN) return cut;
  }
  return -1;
}

interface Emission {
  text: string;
  /** Force the splitter to emit this text as its own segment immediately. */
  flush: boolean;
}

interface Session {
  splitter: TextSplitterStream | null;
  /** Emissions that arrived before the model was ready. */
  pending: Emission[];
  /** Buffer for text still inside the segment-size ramp. */
  buf: string;
  /** Which ramp budget applies next; past the end = natural sentences. */
  segIndex: number;
  closed: boolean;
  cancelled: boolean;
}

const sessions = new Map<number, Session>();

function writeEmission(s: Session, e: Emission): void {
  if (s.splitter) {
    s.splitter.push(e.text);
    if (e.flush) s.splitter.flush();
  } else {
    s.pending.push(e);
  }
}

/** Feed streamed text into a session, applying the segment-size ramp. */
function feedSession(s: Session, text: string): void {
  if (s.segIndex >= SEGMENT_CHAR_BUDGETS.length) {
    writeEmission(s, { text, flush: false });
    return;
  }
  s.buf += text;
  while (s.segIndex < SEGMENT_CHAR_BUDGETS.length) {
    const cut = findCut(s.buf, SEGMENT_CHAR_BUDGETS[s.segIndex]);
    if (cut < 0) return; // wait for more text
    writeEmission(s, { text: s.buf.slice(0, cut), flush: true });
    s.buf = s.buf.slice(cut);
    s.segIndex += 1;
  }
  // Ramp finished — release the tail into natural sentence splitting.
  if (s.buf) {
    writeEmission(s, { text: s.buf, flush: false });
    s.buf = "";
  }
}

/** Close a session's input, draining any text the ramp was still holding. */
function endSession(s: Session): void {
  if (s.closed) return;
  if (s.buf) {
    writeEmission(s, { text: s.buf, flush: false });
    s.buf = "";
  }
  s.closed = true;
  s.splitter?.close();
}

function startSession(id: number, voice: string, dtype?: KokoroDtype): void {
  const s: Session = {
    splitter: null,
    pending: [],
    buf: "",
    segIndex: 0,
    closed: false,
    cancelled: false,
  };
  sessions.set(id, s);

  void (async () => {
    try {
      const tts = await loadModel(dtype);
      if (s.cancelled) return;

      const splitter = new TextSplitterStream();
      const wasClosed = s.closed;
      s.closed = false; // let endSession re-run against the live splitter
      s.splitter = splitter;
      for (const e of s.pending) writeEmission(s, e);
      s.pending.length = 0;
      if (wasClosed) endSession(s);

      // Kokoro types `voice` as a union of literal ids; settings hold a string.
      const streamOptions = { voice } as Parameters<KokoroTTS["stream"]>[1];
      const stream = tts.stream(splitter, streamOptions);

      let segment = 0;
      let t0 = performance.now();
      for await (const chunk of stream as AsyncIterable<{
        text: string;
        audio: { audio: Float32Array; sampling_rate: number };
      }>) {
        if (s.cancelled) break;
        segment += 1;
        console.debug(
          `[tts] segment ${segment} (${chunk.text.length} chars) ready in ${Math.round(performance.now() - t0)}ms`,
        );
        t0 = performance.now();
        // Structured-clone the samples (typically a few hundred KB) rather
        // than transferring — kokoro may reuse its output buffers.
        post({ type: "chunk", id, samples: chunk.audio.audio, sampleRate: chunk.audio.sampling_rate });
      }
      if (!s.cancelled) post({ type: "done", id });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      sessions.delete(id);
    }
  })();
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as MainToWorker;
  switch (msg.type) {
    case "load": {
      const voice = msg.voice;
      void loadModel(msg.dtype)
        .then((tts) => (voice ? prime(tts, voice) : undefined))
        .catch(() => undefined);
      break;
    }
    case "speak-start":
      startSession(msg.id, msg.voice);
      break;
    case "push": {
      const s = sessions.get(msg.id);
      if (!s || s.closed || s.cancelled) break;
      feedSession(s, msg.text);
      break;
    }
    case "close": {
      const s = sessions.get(msg.id);
      if (!s || s.cancelled) break;
      endSession(s);
      break;
    }
    case "cancel": {
      const s = sessions.get(msg.id);
      if (!s) break;
      s.cancelled = true;
      try {
        endSession(s);
      } catch {
        /* already closed */
      }
      break;
    }
  }
};
