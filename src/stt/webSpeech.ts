/**
 * Web Speech API speech-to-text — the DEFAULT voice input.
 *
 * It's built into Chrome/Edge/Safari, needs ZERO download, and starts instantly.
 * (Note: some browsers route this through a cloud recognizer; it's still free and
 * requires no key. Shoppers who want fully-local, no-upload STT can switch to the
 * Moonshine/Whisper engines in Settings.)
 */

export interface WebSpeechCallbacks {
  /** Fired continuously with the best-guess transcript (interim + final). */
  onPartial?: (text: string) => void;
  /** Fired once with the final transcript when recognition ends. */
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export function webSpeechSupported(): boolean {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class WebSpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = "";
  private cancelled = false;

  start(callbacks: WebSpeechCallbacks): void {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      callbacks.onError?.("Speech recognition isn't supported in this browser.");
      return;
    }

    const recognition = new Ctor();
    this.recognition = recognition;
    this.finalText = "";
    this.cancelled = false;

    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false; // stop after a natural pause
    recognition.interimResults = true; // show words as they're recognised
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) this.finalText += final;
      callbacks.onPartial?.((this.finalText + interim).trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === "no-speech") {
        callbacks.onError?.("I didn't catch that — try again?");
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        callbacks.onError?.("Microphone access was blocked. Please allow it and retry.");
      } else if (event.error !== "aborted") {
        callbacks.onError?.(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      const text = this.finalText.trim();
      // A cancelled session discards whatever was heard — nothing is sent.
      if (text && !this.cancelled) callbacks.onFinal?.(text);
      callbacks.onEnd?.();
      this.recognition = null;
    };

    try {
      recognition.start();
    } catch (err) {
      callbacks.onError?.(err instanceof Error ? err.message : "Could not start recognition.");
    }
  }

  stop(): void {
    this.recognition?.stop();
  }

  abort(): void {
    this.cancelled = true;
    this.recognition?.abort();
    this.recognition = null;
  }
}
