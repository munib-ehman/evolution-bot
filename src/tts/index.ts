/**
 * Unified speak() entry point. Picks the configured TTS engine and, crucially,
 * degrades gracefully: if Kokoro fails to load (weak device / no WASM / offline
 * before first cache), it automatically falls back to the browser's built-in
 * SpeechSynthesis so the avatar still talks. Both paths are $0.
 */
import type { TtsEngine } from "../types";
import { speechEngine } from "../audio/speechEngine";
import { speakWithKokoro, type SpeakOptions } from "./kokoro";
import { speakWithBrowser, browserTtsAvailable } from "./browserTts";

export { VOICES, DEFAULT_VOICE, warmUpKokoro, loadKokoro } from "./kokoro";
export type { ModelProgress, SpeakOptions } from "./kokoro";

export async function speak(text: string, engine: TtsEngine, opts: SpeakOptions = {}): Promise<void> {
  if (engine === "off") return;

  if (engine === "browser") {
    return speakWithBrowser(text, opts);
  }

  // engine === "kokoro"
  try {
    await speakWithKokoro(text, opts);
  } catch (err) {
    // Kokoro couldn't load or run — fall back to the free browser voice.
    console.warn("[tts] Kokoro unavailable, falling back to browser speech:", err);
    if (browserTtsAvailable()) {
      await speakWithBrowser(text, opts);
    }
  }
}

/** Stop any in-progress speech immediately. */
export function stopSpeaking(): void {
  speechEngine.stop();
  if (browserTtsAvailable()) window.speechSynthesis.cancel();
}
