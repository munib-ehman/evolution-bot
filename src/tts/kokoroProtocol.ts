/**
 * Message protocol between the main thread (kokoro.ts) and the TTS worker
 * (kokoro.worker.ts). Types only — imported by both sides so they can't drift.
 */

export type KokoroDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

/** Main thread → worker. */
export type MainToWorker =
  | {
      type: "load";
      /** Optional dtype override (from localStorage) for perf experiments. */
      dtype?: KokoroDtype;
      /**
       * Voice to prime after load: a tiny discarded synthesis that fetches the
       * voice embedding, initializes the phonemizer, and JITs the inference
       * path — so the first real turn pays none of those one-time costs.
       */
      voice?: string;
    }
  | { type: "speak-start"; id: number; voice: string }
  | { type: "push"; id: number; text: string }
  | { type: "close"; id: number }
  | { type: "cancel"; id: number };

/** Worker → main thread. */
export type WorkerToMain =
  | { type: "progress"; progress: number | null; label: string }
  | { type: "ready"; device: "webgpu" | "wasm"; dtype: KokoroDtype }
  | { type: "load-error"; message: string }
  | { type: "chunk"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };
