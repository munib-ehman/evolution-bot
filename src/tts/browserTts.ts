/**
 * Browser SpeechSynthesis fallback — zero download, works even on low-power
 * devices where Kokoro is too heavy. It's free and built into the browser.
 *
 * SpeechSynthesis doesn't give us raw audio to analyse, so we put the shared
 * speechEngine into "procedural" mode: the avatar's mouth is driven by a
 * synthesised talking envelope for the duration of the utterance.
 */
import { speechEngine } from "../audio/speechEngine";
import type { SpeakOptions } from "./kokoro";

export function browserTtsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Try to pick a pleasant English voice; fall back to the default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const preferred =
    en.find((v) => /female|aria|jenny|samantha|zira/i.test(v.name)) ?? en[0] ?? voices[0];
  return preferred ?? null;
}

export function speakWithBrowser(text: string, opts: SpeakOptions = {}): Promise<void> {
  const { signal, onFirstAudio } = opts;
  const clean = text.trim();
  if (!clean || !browserTtsAvailable()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = 1.0;
    utter.pitch = 1.0;

    const finish = () => {
      speechEngine.setProcedural(false);
      resolve();
    };

    utter.onstart = () => {
      speechEngine.setProcedural(true);
      onFirstAudio?.();
    };
    utter.onend = finish;
    utter.onerror = finish;

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          window.speechSynthesis.cancel();
          finish();
        },
        { once: true },
      );
    }

    window.speechSynthesis.cancel(); // clear any queued utterance (barge-in)
    window.speechSynthesis.speak(utter);
  });
}
