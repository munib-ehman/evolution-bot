/**
 * Voice-turn latency instrumentation (Phase 0 of the latency work).
 *
 * Measures the stages of a turn so every optimization proves itself with
 * numbers instead of vibes:
 *
 *   begin ─ llmFirstToken ─ llmDone ─ ttsFirstAudio ─ speakDone
 *
 * Always on in dev; enable in production with
 *   localStorage.setItem("evolution-latency", "1")
 * Output is one console.table per turn — zero overhead when disabled.
 */

const FLAG_KEY = "evolution-latency";

export type LatencyStage = "llmFirstToken" | "llmDone" | "ttsFirstAudio" | "speakDone";

function enabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

let turnStart = 0;
let turnSource = "";
let marks: { stage: string; ms: number }[] = [];

export const lat = {
  /** Start timing a turn. For voice this is the moment the transcript fires. */
  begin(source: "voice" | "text"): void {
    if (!enabled()) return;
    turnStart = performance.now();
    turnSource = source;
    marks = [];
  },

  mark(stage: LatencyStage): void {
    if (!enabled() || turnStart === 0) return;
    // Only the first occurrence of a stage counts (e.g. first token).
    if (marks.some((m) => m.stage === stage)) return;
    marks.push({ stage, ms: Math.round(performance.now() - turnStart) });
  },

  /**
   * How long the browser sat between the last interim result and the final
   * transcript — the STT endpointing cost we don't control directly.
   */
  sttEndpoint(ms: number): void {
    if (!enabled()) return;
    console.debug(`[latency] stt endpointing: ${Math.round(ms)}ms (last interim → final)`);
  },

  /** Print the turn's table and reset. Call from the send loop's finally. */
  report(): void {
    if (!enabled() || turnStart === 0) return;
    const total = Math.round(performance.now() - turnStart);
    console.table([...marks, { stage: `total (${turnSource})`, ms: total }]);
    turnStart = 0;
    marks = [];
  },
};
