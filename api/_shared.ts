/**
 * Shared constants for the /api proxy functions (and the dev-server
 * middleware in dev-api.ts, which imports these so dev === prod).
 *
 * Files starting with "_" in api/ are helpers — Vercel does not expose them
 * as endpoints.
 */

export const GROQ_BASE = "https://api.groq.com/openai/v1";

export const CHAT_MODEL_DEFAULT = "llama-3.3-70b-versatile";

/** Groq's hosted Orpheus TTS (playai-tts was decommissioned). */
export const TTS_MODEL_DEFAULT = "canopylabs/orpheus-v1-english";
export const TTS_VOICE_DEFAULT = "autumn";

/** Orpheus caps input at 200 chars per request; the client splits to fit. */
export const TTS_MAX_CHARS = 200;

/** Loose caps so a stray client can't relay giant payloads through us. */
export const CHAT_MAX_MESSAGES = 24;
export const CHAT_MAX_TOTAL_CHARS = 24_000;

/**
 * The app's voice settings still hold Kokoro voice ids (the offline fallback
 * voices). Map them to the closest Orpheus persona server-side so the two
 * engines stay roughly in character.
 */
export const VOICE_MAP: Record<string, string> = {
  af_heart: "autumn",
  af_bella: "diana",
  af_nicole: "hannah",
  af_sky: "hannah",
  am_michael: "austin",
  am_puck: "troy",
  bf_emma: "diana",
  bm_george: "daniel",
};

const ORPHEUS_VOICES = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);

export function mapVoice(voice?: string): string {
  if (!voice) return TTS_VOICE_DEFAULT;
  if (ORPHEUS_VOICES.has(voice)) return voice;
  return VOICE_MAP[voice] ?? TTS_VOICE_DEFAULT;
}
