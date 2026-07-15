/**
 * SpeechEngine — a tiny Web Audio wrapper shared by the whole app.
 *
 * Why it exists:
 *  - Kokoro streams audio out in chunks (Float32 PCM). We schedule those chunks
 *    back-to-back so playback is gapless and starts as early as possible.
 *  - An AnalyserNode taps the exact audio being played so the 3D avatar can read
 *    a live amplitude (0..1) every frame and drive its jaw/visemes — real
 *    lip-sync, not a guess.
 *  - It also supports a "procedural" mode for the browser SpeechSynthesis
 *    fallback, where we don't have raw PCM to analyse and instead synthesise a
 *    mouth-movement signal.
 *
 * It's a module-level singleton so the React tree and the react-three-fiber
 * render loop can both reach the same audio without prop-drilling.
 */

class SpeechEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private timeData: Float32Array<ArrayBuffer> = new Float32Array(2048);

  /** Playback cursor: the AudioContext time at which the next chunk should start. */
  private nextTime = 0;
  /** Currently scheduled sources, so we can hard-stop (barge-in). */
  private sources = new Set<AudioBufferSourceNode>();
  /** Smoothed amplitude, so the mouth doesn't jitter frame-to-frame. */
  private smoothed = 0;

  /** True while the SpeechSynthesis fallback is talking (no PCM to analyse). */
  private procedural = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext!;
      this.ctx = new Ctor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.nextTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  /**
   * Must be called from a user gesture (click/tap) at least once — browsers keep
   * AudioContext suspended until then. We call it when the user sends a message.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore — some browsers resume lazily on first play */
      }
    }
  }

  /** Decode compressed audio (e.g. a WAV response) into an AudioBuffer. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    return ctx.decodeAudioData(data);
  }

  /** Queue one chunk of mono PCM for gapless playback. */
  enqueue(samples: Float32Array, sampleRate: number): void {
    if (samples.length === 0) return;
    const ctx = this.ensureContext();

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    // Copy so we don't hold a reference to a buffer the caller may reuse.
    buffer.copyToChannel(samples.slice(), 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser!);

    // Start right after whatever is already queued (with a hair of lead-in the
    // first time so we never schedule in the past).
    const startAt = Math.max(ctx.currentTime + 0.03, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;

    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** True while real PCM is still scheduled to play. */
  isSpeaking(): boolean {
    if (this.procedural) return true;
    return !!this.ctx && this.ctx.currentTime < this.nextTime - 0.02;
  }

  /**
   * Current mouth-openness in 0..1, smoothed. Read this once per animation frame.
   * Uses the analyser for real audio, or a synthesised wobble in procedural mode.
   */
  getLevel(elapsedSeconds = 0): number {
    let target = 0;

    if (this.procedural) {
      // No PCM available (SpeechSynthesis). Fake a lively talking envelope by
      // layering a couple of sines so the mouth looks like it's forming syllables.
      const t = elapsedSeconds;
      const s =
        0.5 +
        0.35 * Math.sin(t * 13.0) +
        0.15 * Math.sin(t * 27.0 + 1.3);
      target = Math.min(1, Math.max(0, s));
    } else if (this.analyser && this.isSpeaking()) {
      this.analyser.getFloatTimeDomainData(this.timeData);
      let sum = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const v = this.timeData[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.timeData.length);
      // Speech RMS is small; scale it up and clamp. Feels right around 3–4x.
      target = Math.min(1, rms * 3.8);
    }

    // Asymmetric smoothing: open the mouth quickly, close it a little slower.
    const k = target > this.smoothed ? 0.55 : 0.22;
    this.smoothed += (target - this.smoothed) * k;
    if (this.smoothed < 0.001) this.smoothed = 0;
    return this.smoothed;
  }

  /** Enter/leave procedural (SpeechSynthesis) lip-sync mode. */
  setProcedural(on: boolean): void {
    this.procedural = on;
  }

  /** Wait until all queued audio has finished playing (or the signal aborts). */
  async waitUntilDone(signal?: AbortSignal): Promise<void> {
    while (this.isSpeaking()) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /** Hard stop everything immediately (used for barge-in / new question). */
  stop(): void {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.procedural = false;
    if (this.ctx) this.nextTime = this.ctx.currentTime;
    this.smoothed = 0;
  }
}

export const speechEngine = new SpeechEngine();
