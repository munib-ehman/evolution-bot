/**
 * Default avatar: a modern, realistic-style **female** Ready Player Me full-body
 * avatar, served from a public repo via raw.githubusercontent.com — a permanent,
 * CORS-enabled URL (unlike RPM CDN model IDs, which get rotated/deleted). It ships
 * with the full ARKit blendshape set + all Oculus visemes, so lip-sync, blinking,
 * eye-gaze and brow micro-expressions all work out of the box.
 *
 * Her default hair is purple; we recolor it to blonde at load time (see RpmAvatar)
 * only for this default avatar, so a custom avatar you set is never touched.
 *
 * Swap it for your own (see README): create one free at readyplayer.me and append
 * `?morphTargets=ARKit,Oculus%20Visemes`. If a URL ever fails to load, the app falls
 * back to a built-in procedural head so it never breaks.
 */
export const DEFAULT_AVATAR_URL = `${import.meta.env.BASE_URL}models/sherry.glb`;

/** True for the bundled Sherry model (an Auto-Rig Pro character driven by bones). */
export function isSherryModel(url: string): boolean {
  return url.includes("sherry.glb");
}

/**
 * The bundled Ready Player Me avatar (full ARKit + Oculus visemes). Kept as a
 * reference: paste it into Settings to get a fully lip-synced, blinking avatar.
 * When it's loaded we recolor its stock purple hair to blonde (see RpmAvatar).
 */
export const RPM_BLONDE_URL =
  "https://raw.githubusercontent.com/wass08/r3f-virtual-girlfriend-frontend/main/public/models/64f1a714fe61576b46f27ca2.glb";

/** Warm blonde applied to the RPM avatar's hair. Tweak to taste. */
export const DEFAULT_HAIR_COLOR = "#e8c987";

/** ARKit blendshape names we drive (present on RPM avatars). */
export const MORPH = {
  jawOpen: "jawOpen",
  mouthOpen: "mouthOpen",
  mouthSmile: "mouthSmileLeft", // paired with right below
  mouthSmileRight: "mouthSmileRight",
  eyeBlinkLeft: "eyeBlinkLeft",
  eyeBlinkRight: "eyeBlinkRight",
  // Micro-expression: brows lift on stressed syllables & upward glances.
  browInnerUp: "browInnerUp",
  browOuterUpLeft: "browOuterUpLeft",
  browOuterUpRight: "browOuterUpRight",
  // Brows drawn down/together — the concentration furrow used by the thinking pose.
  browDownLeft: "browDownLeft",
  browDownRight: "browDownRight",
  // Eyes widen a touch on emphasis, making the face feel engaged.
  eyeWideLeft: "eyeWideLeft",
  eyeWideRight: "eyeWideRight",
} as const;

/**
 * ARKit eye-look blendshapes. Driving these gives the avatar living, darting eyes
 * (micro-saccades) instead of a frozen stare — the single biggest "not a robot"
 * win. `In`/`Out` are relative to the nose (In = toward nose, Out = toward temple).
 */
export const EYE_LOOK = {
  inLeft: "eyeLookInLeft",
  outLeft: "eyeLookOutLeft",
  upLeft: "eyeLookUpLeft",
  downLeft: "eyeLookDownLeft",
  inRight: "eyeLookInRight",
  outRight: "eyeLookOutRight",
  upRight: "eyeLookUpRight",
  downRight: "eyeLookDownRight",
} as const;

/** Every eye-look morph, for cheaply zeroing them before re-applying gaze. */
export const EYE_LOOK_ALL: readonly string[] = Object.values(EYE_LOOK);

/** Oculus visemes we pick from for mouth *shape* while speaking. */
export const VISEMES = ["viseme_aa", "viseme_O", "viseme_E", "viseme_U", "viseme_I"] as const;
