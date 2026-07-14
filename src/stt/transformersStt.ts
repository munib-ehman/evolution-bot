/**
 * Fully-local speech-to-text via Transformers.js — NOTHING is uploaded anywhere.
 *
 * Models (both free, downloaded once from the HF CDN and then cached):
 *   - moonshine → onnx-community/moonshine-tiny-ONNX  (fast, English, ~50MB)
 *   - whisper   → Xenova/whisper-tiny                 (multilingual, ~75MB)
 *
 * Flow: record mic audio (MediaRecorder) → decode & resample to 16kHz mono →
 * run the ASR pipeline entirely on-device (WebGPU or WASM) → return text.
 */
import type { SttEngine } from "../types";
import { hasWebGPU } from "../lib/capabilities";
import type { ModelProgress } from "../tts/kokoro";

const MODEL_IDS: Record<Exclude<SttEngine, "webspeech">, string> = {
  moonshine: "onnx-community/moonshine-tiny-ONNX",
  whisper: "Xenova/whisper-tiny",
};

const TARGET_SAMPLE_RATE = 16000;

// Lazy per-engine pipeline cache — a pipeline is a callable async function.
type Transcriber = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string }>;
const pipelines = new Map<string, Promise<Transcriber>>();

async function getTranscriber(
  engine: Exclude<SttEngine, "webspeech">,
  onProgress?: (p: ModelProgress) => void,
): Promise<Transcriber> {
  const modelId = MODEL_IDS[engine];
  let existing = pipelines.get(modelId);
  if (!existing) {
    existing = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device: "webgpu" | "wasm" = (await hasWebGPU()) ? "webgpu" : "wasm";
      const transcriber = await pipeline("automatic-speech-recognition", modelId, {
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback: (e: unknown) => {
          if (!onProgress) return;
          const ev = e as { status?: string; progress?: number };
          onProgress({
            progress: typeof ev.progress === "number" ? ev.progress / 100 : null,
            label: ev.status === "ready" ? "Ready" : "Warming up speech recognition…",
          });
        },
      });
      return transcriber as unknown as Transcriber;
    })();
    existing.catch(() => pipelines.delete(modelId));
    pipelines.set(modelId, existing);
  }
  return existing;
}

/** Preload a local STT model so the first transcription isn't slow. */
export function warmUpLocalStt(engine: Exclude<SttEngine, "webspeech">, onProgress?: (p: ModelProgress) => void): void {
  void getTranscriber(engine, onProgress).catch(() => undefined);
}

/** Decode a recorded audio Blob to a 16kHz mono Float32Array. */
async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext!;
  const decodeCtx = new AC();
  try {
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    // Downmix to mono.
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    if (decoded.sampleRate === TARGET_SAMPLE_RATE) return mono;

    // Resample to 16kHz using an OfflineAudioContext.
    const durationSec = length / decoded.sampleRate;
    const outLength = Math.ceil(durationSec * TARGET_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, outLength, TARGET_SAMPLE_RATE);
    const buffer = offline.createBuffer(1, length, decoded.sampleRate);
    buffer.copyToChannel(mono, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    void decodeCtx.close();
  }
}

/**
 * Records from the microphone until stop() is called, then transcribes locally.
 * Usage:
 *   const rec = new LocalRecorder("moonshine");
 *   await rec.start();
 *   // ...user speaks...
 *   const text = await rec.stopAndTranscribe();
 */
export class LocalRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  constructor(private engine: Exclude<SttEngine, "webspeech">) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }

  async stopAndTranscribe(): Promise<string> {
    const recorder = this.mediaRecorder;
    if (!recorder) return "";

    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });
    this.cleanup();

    if (blob.size === 0) return "";
    const audio = await blobToMono16k(blob);
    const transcriber = await getTranscriber(this.engine);
    const result = await transcriber(audio, { language: "english", chunk_length_s: 30 });
    return (result?.text ?? "").trim();
  }

  abort(): void {
    try {
      this.mediaRecorder?.stop();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }
}
