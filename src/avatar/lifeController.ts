/**
 * LifeController — turns "what time is it" + "how loud is the speech right now"
 * into a full frame of *human* micro-behaviour. Both the Ready Player Me avatar
 * and the procedural fallback consume the exact same signals, so they feel equally
 * alive. Nothing here touches three.js — it's pure math, returning a plain struct
 * the renderers map onto their own rigs.
 *
 * What makes a face read as alive rather than robotic (and what this produces):
 *   - Eye saccades: the eyes never sit still. They dart to a point, hold, dart
 *     again — biased toward the viewer, with the occasional wider glance away.
 *   - Natural blinks: fast-close / slow-open curve, random cadence, the odd
 *     double-blink, and an extra blink triggered on big gaze shifts (as real eyes
 *     do). Not a metronome.
 *   - Organic head motion: layered value-noise drift (never a clean sine), plus a
 *     little gaze-following and speech-driven nodding.
 *   - Speech-aware expression: brows lift and eyes widen a touch on stressed
 *     syllables; the resting smile eases with slow noise and relaxes while talking.
 *   - Coordinated lip-sync: mouth *shapes* change on syllable onsets (rising audio
 *     energy) and ease in/out — not a shape-per-timer flicker.
 */

// ── Organic noise ───────────────────────────────────────────────────────────
// A tiny, dependency-free 1-D value noise. Smooth, deterministic, and — unlike a
// bare sine — never lands on an obviously repeating beat, which is what sells the
// idle motion as "a person breathing" rather than "an animated prop".
function fract(x: number): number {
  return x - Math.floor(x);
}
function hash(n: number): number {
  return fract(Math.sin(n) * 43758.5453123);
}
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; // → −1..1
}
/** Fractal (multi-octave) noise for richer, less predictable drift. */
export function fbm(x: number): number {
  let a = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 3; o++) {
    a += amp * noise1(x * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return a; // ≈ −1..1
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Frame-rate-independent approach factor for `a += (b-a)*approach(...)`. */
const approach = (delta: number, rate: number) => 1 - Math.exp(-rate * delta);

/** Blink shape: fast close, brief hold, slower open. p ∈ 0..1 → lid-closed 0..1. */
function blinkCurve(p: number): number {
  if (p < 0.35) return p / 0.35; // closing (fast)
  if (p < 0.5) return 1; // held shut
  return 1 - (p - 0.5) / 0.5; // opening (slower)
}

/** One frame of behaviour. All angles in radians; everything else 0..1 unless noted. */
export interface LifeFrame {
  jaw: number;
  mouthOpen: number;
  /** Active viseme morph name while speaking, else null. */
  viseme: string | null;
  visemeWeight: number;
  /**
   * Generic mouth-shape channels for BONE-rigged faces (no viseme morphs).
   * Derived from the same syllable-onset viseme picks, smoothed:
   *   lipWide  — corners pulled back (E/I sounds)
   *   lipRound — corners puckered forward (O/U sounds)
   *   lipRaise — upper lip lifted, teeth showing (bright vowels)
   */
  lipWide: number;
  lipRound: number;
  lipRaise: number;
  smile: number;
  browInner: number;
  browOuter: number;
  /** Concentration furrow (brows drawn down/together), 0..1 — rises while thinking. */
  browDown: number;
  eyeWide: number;
  /** Lid-closed amount for both eyes, 0..1. */
  blink: number;
  /** Gaze direction in screen space: x = −1 (viewer-left) … +1 (viewer-right); y up. */
  gazeX: number;
  gazeY: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  /** Small vertical position offset for the breathing bob. */
  bob: number;
}

const VISEME_NAMES = ["viseme_aa", "viseme_O", "viseme_E", "viseme_U", "viseme_I"];

/** Mouth-shape targets per viseme, for bone-rigged faces: wide / round / raise. */
const VISEME_POSE: Record<string, { w: number; r: number; u: number }> = {
  viseme_aa: { w: 0.1, r: 0, u: 0.2 },
  viseme_O: { w: 0, r: 0.9, u: 0 },
  viseme_E: { w: 0.85, r: 0, u: 0.5 },
  viseme_U: { w: 0, r: 1, u: 0 },
  viseme_I: { w: 0.6, r: 0, u: 0.3 },
};

export class LifeController {
  private frame: LifeFrame = {
    jaw: 0, mouthOpen: 0, viseme: null, visemeWeight: 0, smile: 0.12,
    lipWide: 0, lipRound: 0, lipRaise: 0,
    browInner: 0, browOuter: 0, browDown: 0, eyeWide: 0, blink: 0,
    gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, headRoll: 0, bob: 0,
  };

  // Smoothed mouth-shape channels (bone-rig lip-sync).
  private wWide = 0;
  private wRound = 0;
  private wRaise = 0;

  // Smoothed "is thinking" weight, 0..1. Eases in when the brain is processing
  // so the pondering pose blends in/out rather than snapping.
  private think = 0;
  // Which way the eyes drift while pondering; flips slowly so it looks like she's
  // genuinely searching her memory rather than staring at one spot.
  private ponderSide = 1;

  // Blink scheduling.
  private nextBlinkAt = 1.2;
  private blinkPhase = 0; // 0 = open; ramps 0→1 across one blink
  private doubleQueued = false;

  // Gaze (eye saccades).
  private tgtX = 0;
  private tgtY = 0;
  private curX = 0;
  private curY = 0;
  private nextSaccadeAt = 0.8;

  // Lip-sync viseme selection.
  private visIdx = 0;
  private visWeight = 0;
  private lastVisChange = 0;
  private prevLevel = 0;

  /** Pick a new gaze target. Mostly small glances near the viewer; occasionally wider. */
  private scheduleSaccade(t: number): void {
    const r = Math.random();
    if (r < 0.28) {
      // Return attention to the viewer.
      this.tgtX = (Math.random() * 2 - 1) * 0.05;
      this.tgtY = (Math.random() * 2 - 1) * 0.04;
    } else if (r < 0.8) {
      // Small, human "thinking" glance.
      this.tgtX = (Math.random() * 2 - 1) * 0.3;
      this.tgtY = (Math.random() * 2 - 1) * 0.18;
    } else {
      // Occasional wider look away.
      this.tgtX = (Math.random() * 2 - 1) * 0.62;
      this.tgtY = (Math.random() * 2 - 1) * 0.34;
    }
    this.nextSaccadeAt = t + 0.8 + Math.random() * 2.1;
    // We blink on roughly a third of saccades, as real eyes do.
    if (Math.random() < 0.34 && this.blinkPhase === 0) this.startBlink(false);
  }

  private startBlink(fromSchedule: boolean): void {
    this.blinkPhase = 1e-4;
    if (fromSchedule && Math.random() < 0.15) this.doubleQueued = true;
  }

  /**
   * Advance one frame.
   * @param level    smoothed speech amplitude 0..1 (drives lip-sync)
   * @param thinking true while the brain is processing — plays a pondering pose
   */
  update(t: number, delta: number, level: number, thinking = false): LifeFrame {
    const f = this.frame;
    const d = Math.min(delta, 0.05); // guard against tab-switch time jumps

    // Ease the thinking weight toward its target so the pose blends smoothly.
    this.think += ((thinking ? 1 : 0) - this.think) * approach(d, 6);

    // ── Eye saccades ──────────────────────────────────────────────────────────
    if (t > this.nextSaccadeAt) this.scheduleSaccade(t);
    // Eyes snap to target fast (saccades are near-instant), then hold.
    const k = approach(d, 22);
    this.curX += (this.tgtX - this.curX) * k;
    this.curY += (this.tgtY - this.curY) * k;
    f.gazeX = this.curX;
    f.gazeY = this.curY;

    // ── Blinking ──────────────────────────────────────────────────────────────
    if (t > this.nextBlinkAt && this.blinkPhase === 0) this.startBlink(true);
    if (this.blinkPhase > 0) {
      this.blinkPhase += d / 0.16; // ~160ms per blink
      f.blink = blinkCurve(Math.min(1, this.blinkPhase));
      if (this.blinkPhase >= 1) {
        this.blinkPhase = 0;
        f.blink = 0;
        if (this.doubleQueued) {
          this.doubleQueued = false;
          this.blinkPhase = 1e-4; // immediate second blink
        } else {
          this.nextBlinkAt = t + 2.5 + Math.random() * 3.8; // 2.5–6.3s
        }
      }
    } else {
      f.blink = 0;
    }

    // ── Lip-sync ──────────────────────────────────────────────────────────────
    const rising = level - this.prevLevel;
    const dwell = t - this.lastVisChange;
    // Change mouth *shape* on a syllable onset (energy rising past a threshold),
    // with a minimum dwell so it doesn't flutter. Far more natural than a timer.
    if (level > 0.06 && rising > 0.02 && dwell > 0.09) {
      let n = this.visIdx;
      while (n === this.visIdx) n = Math.floor(Math.random() * VISEME_NAMES.length);
      this.visIdx = n;
      this.lastVisChange = t;
    }
    this.prevLevel = level;
    const targetVis = level > 0.04 ? Math.min(1, level * 1.3) : 0;
    this.visWeight += (targetVis - this.visWeight) * approach(d, 16);
    f.viseme = level > 0.02 ? VISEME_NAMES[this.visIdx] : null;
    f.visemeWeight = this.visWeight;
    f.jaw = Math.min(1, level * 1.15);
    f.mouthOpen = f.jaw * 0.45;

    // Bone-rig mouth shapes: ease toward the active viseme's wide/round/raise
    // targets (scaled by its weight), and relax to neutral in silence. Slightly
    // slower than the jaw so shapes glide between syllables like real lips do.
    const pose = f.viseme ? VISEME_POSE[f.viseme] : { w: 0, r: 0, u: 0 };
    const kv = approach(d, 13);
    this.wWide += (pose.w * this.visWeight - this.wWide) * kv;
    this.wRound += (pose.r * this.visWeight - this.wRound) * kv;
    this.wRaise += (pose.u * this.visWeight - this.wRaise) * kv;
    f.lipWide = this.wWide;
    f.lipRound = this.wRound;
    f.lipRaise = this.wRaise;

    // ── Brows & eye-widen (speech emphasis + upward gaze) ─────────────────────
    const emphasis = Math.max(0, rising) * 3.5; // spikes on stressed syllables
    f.browInner = clamp01(0.06 + 0.12 * (fbm(t * 0.13 + 5) * 0.5 + 0.5) + emphasis + Math.max(0, this.curY) * 0.35);
    f.browOuter = clamp01(0.04 + emphasis * 0.7 + Math.max(0, this.curY) * 0.25);
    f.eyeWide = clamp01(emphasis * 0.6 + Math.max(0, this.curY) * 0.2);

    // ── Resting smile: slow noise, relaxing while talking ─────────────────────
    f.smile = clamp01(0.13 + 0.05 * fbm(t * 0.05 + 3)) * (1 - 0.55 * level);

    // ── Head pose: organic noise + gaze follow + speech nod ────────────────────
    f.headYaw = fbm(t * 0.09) * 0.05 + this.curX * 0.13;
    f.headPitch = fbm(t * 0.11 + 10) * 0.035 - this.curY * 0.09 + Math.sin(t * 5.5) * level * 0.018;
    f.headRoll = fbm(t * 0.07 + 20) * 0.028 + this.curX * 0.02;

    // ── Breathing bob ─────────────────────────────────────────────────────────
    f.bob = Math.sin(t * 1.4) * 0.005 + fbm(t * 0.3 + 40) * 0.004;

    // ── Thinking / "processing" pose ──────────────────────────────────────────
    // Blended in by `think` (0..1). Reads as a person mulling something over:
    // eyes cast up-and-away and slowly wander, the head tilts and gives a slow
    // contemplative nod, the brows knit into a concentration furrow, and the
    // resting smile eases off. Everything is a *blend* over the live idle motion,
    // so blinks and breathing keep going and it never looks frozen.
    const think = this.think;
    f.browDown = 0;
    if (think > 0.001) {
      // Flip the glance side occasionally (slow noise) — searching, not staring.
      this.ponderSide = fbm(t * 0.09 + 50) >= 0 ? 1 : -1;
      const wanderX = this.ponderSide * (0.34 + 0.16 * (fbm(t * 0.5 + 2) * 0.5 + 0.5));
      const wanderY = 0.4 + 0.2 * (fbm(t * 0.42 + 9) * 0.5 + 0.5); // up, into memory
      f.gazeX += (wanderX - f.gazeX) * think;
      f.gazeY += (wanderY - f.gazeY) * think;

      // Head: a held tilt plus a slow "hmm" nod and a little sway.
      const tilt = this.ponderSide * 0.11 + fbm(t * 0.5 + 30) * 0.02;
      const nod = Math.sin(t * 2.1) * 0.02 + 0.03;
      f.headRoll += (tilt - f.headRoll) * think;
      f.headPitch += nod * think;
      f.headYaw += (this.ponderSide * 0.06 - f.headYaw) * 0.4 * think;

      // Face: knit the brows (concentration), lift the inner brow a touch, and
      // let the smile relax into a thoughtful, near-neutral mouth.
      f.browDown = think * (0.45 + 0.12 * (fbm(t * 0.8) * 0.5 + 0.5));
      f.browInner = Math.max(f.browInner, think * 0.3);
      f.browOuter *= 1 - 0.6 * think;
      f.eyeWide *= 1 - 0.7 * think;
      f.smile *= 1 - 0.75 * think;
    }

    return f;
  }
}

/**
 * Map a screen-space gaze direction to the eight ARKit eye-look weights.
 * Positive x = viewer-right (the character's *left*), so the character's left eye
 * rotates outward while the right eye rotates inward, keeping both eyes parallel.
 */
export function eyeLookWeights(x: number, y: number): Record<string, number> {
  const s = 0.7; // don't drive eyes to their painful extremes
  const right = Math.max(0, x) * s;
  const left = Math.max(0, -x) * s;
  const up = Math.max(0, y) * s;
  const down = Math.max(0, -y) * s;
  return {
    eyeLookOutLeft: right,
    eyeLookInRight: right,
    eyeLookInLeft: left,
    eyeLookOutRight: left,
    eyeLookUpLeft: up,
    eyeLookUpRight: up,
    eyeLookDownLeft: down,
    eyeLookDownRight: down,
  };
}
