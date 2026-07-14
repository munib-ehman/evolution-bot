/**
 * useAssistant — the heart of the app. It owns the conversation and runs the
 * end-to-end loop:
 *
 *   [text typed]  ─┐
 *                  ├─▶ LLM brain (mock or free-tier API) ─▶ reply text
 *   [mic → STT] ───┘                                          │
 *                                                             ▼
 *                                   Kokoro TTS (streaming) ─▶ Web Audio playback
 *                                                             │
 *                                                             ▼
 *                                   analyser amplitude ─▶ avatar lip-sync
 *
 * Everything except the optional LLM call runs on the shopper's device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message, Product, Settings } from "../types";
import { getAssistantReply, isMockMode } from "../llm/client";
import { speak, stopSpeaking, warmUpKokoro, DEFAULT_VOICE, type ModelProgress } from "../tts";
import { WebSpeechRecognizer, webSpeechSupported } from "../stt/webSpeech";
import { LocalRecorder } from "../stt/transformersStt";
import { DEFAULT_AVATAR_URL } from "../avatar/constants";
import { loadJSON, saveJSON } from "../lib/storage";
import { hasWebSpeech, hasMicrophone } from "../lib/capabilities";
import { logChat } from "../lib/chatLog";

export type AssistantStatus = "idle" | "thinking" | "speaking";
export type MicState = "idle" | "listening" | "transcribing";

// Bump this suffix whenever a default changes in a way that must override a
// previously-persisted value (e.g. the default avatar URL). Old settings are
// then discarded instead of shadowing the new default.
// v7: voice-first — talk mode became the enforced default for everyone.
const SETTINGS_KEY = "shop-avatar-settings-v7";

const DEFAULT_SETTINGS: Settings = {
  sttEngine: "webspeech",
  ttsEngine: "kokoro",
  voice: DEFAULT_VOICE,
  avatarUrl: DEFAULT_AVATAR_URL,
  textOnly: false,
};

// Give the avatar a beat to visibly "think" before answering. Real LLM calls
// usually exceed this on their own; in mock mode (instant) it's what makes the
// pondering pose readable instead of a single flashed frame.
const MIN_THINK_MS = 700;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useAssistant() {
  const [products, setProducts] = useState<Product[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [micState, setMicState] = useState<MicState>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsProgress, setTtsProgress] = useState<ModelProgress | null>(null);
  const [avatarFellBack, setAvatarFellBack] = useState(false);
  // True once the product catalog has resolved (loaded OR failed) — one of the
  // signals the boot splash waits on before revealing the app.
  const [catalogReady, setCatalogReady] = useState(false);

  const [settings, setSettings] = useState<Settings>(() =>
    loadJSON<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  );

  // Refs mirror state for use inside async callbacks without stale closures.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const abortRef = useRef<AbortController | null>(null);
  const recognizerRef = useRef<WebSpeechRecognizer | null>(null);
  const recorderRef = useRef<LocalRecorder | null>(null);
  // Lets `send` re-arm the mic for the hands-free talk-mode loop without a
  // declaration-order cycle (startListening is defined further down).
  const startListeningRef = useRef<() => void>(() => {});
  // The app disables hands-free re-listening while the chat view is open, so
  // the mic never surprise-activates outside the voice stage.
  const handsFreeRef = useRef(true);

  // Load the product catalog (static file, no backend).
  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}products.json`;
    fetch(url)
      .then((r) => r.json())
      .then((data: Product[]) => setProducts(data))
      .catch(() => setError("Couldn't load the product catalog."))
      .finally(() => setCatalogReady(true));
  }, []);

  // Greeting on first load.
  useEffect(() => {
    setMessages([
      {
        id: newId(),
        role: "assistant",
        content: isMockMode
          ? "Hey, welcome to Evolution! I'm your AI copilot — tap the mic and ask about your catalog or hand me a task. Prefer typing? Switch anytime."
          : "Welcome to Evolution! I'm your AI copilot. Tap the mic and tell me what to take off your plate today.",
      },
    ]);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveJSON(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  /** Core: send a user turn, get a reply, speak it (unless text-only). */
  const send = useCallback(
    async (rawText: string, opts?: { fromVoice?: boolean }) => {
      const text = rawText.trim();
      if (!text || status === "thinking") return;

      // Barge-in: stop any current speech and cancel any in-flight reply.
      stopSpeaking();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      const userMsg: Message = { id: newId(), role: "user", content: text };
      appendMessage(userMsg);
      logChat("user", text);
      setStatus("thinking");

      const cfg = settingsRef.current;
      const history = [...messagesRef.current, userMsg];
      const thinkStart = performance.now();

      try {
        const reply = await getAssistantReply(history, products, { signal: controller.signal });
        if (controller.signal.aborted) return;

        // Hold the "thinking" pose for a readable minimum beat.
        const elapsed = performance.now() - thinkStart;
        if (elapsed < MIN_THINK_MS) {
          await new Promise((r) => setTimeout(r, MIN_THINK_MS - elapsed));
          if (controller.signal.aborted) return;
        }

        const assistantMsg: Message = { id: newId(), role: "assistant", content: reply, pending: true };
        appendMessage(assistantMsg);
        logChat("assistant", reply);

        const speakable = !cfg.textOnly && cfg.ttsEngine !== "off";
        if (speakable) {
          setStatus("speaking");
          await speak(reply, cfg.ttsEngine, {
            voice: cfg.voice,
            signal: controller.signal,
          });
        }
        updateMessage(assistantMsg.id, { pending: false });

        // Hands-free conversation: if this turn came in BY VOICE, re-open the mic
        // once Evolution finishes speaking so the founder can just reply. Typed
        // turns never surprise-activate the mic. Only for the browser recognizer
        // (which streams a final result on its own); the local recorders need an
        // explicit stop, so they stay tap-to-talk.
        if (
          opts?.fromVoice &&
          speakable &&
          cfg.sttEngine === "webspeech" &&
          !cfg.textOnly &&
          !controller.signal.aborted
        ) {
          setTimeout(() => {
            if (handsFreeRef.current) startListeningRef.current();
          }, 350);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[assistant] reply failed:", err);
        const msg =
          err instanceof Error && /LLM/.test(err.message)
            ? "I had trouble reaching my brain just now. You can keep chatting — I'll fall back to my built-in answers."
            : "Sorry, something went wrong. Mind trying that again?";
        setError(msg);
        appendMessage({ id: newId(), role: "assistant", content: msg });
      } finally {
        if (!controller.signal.aborted) setStatus("idle");
      }
    },
    [appendMessage, updateMessage, products, status],
  );

  // ── Microphone / speech-to-text ────────────────────────────────────────────
  const micSupported = useMemo(() => {
    const cfg = settings;
    if (cfg.sttEngine === "webspeech") return hasWebSpeech();
    return hasMicrophone();
  }, [settings]);

  const startListening = useCallback(async () => {
    if (micState !== "idle") return;
    setError(null);
    setLiveTranscript("");
    const cfg = settingsRef.current;

    if (cfg.sttEngine === "webspeech") {
      if (!webSpeechSupported()) {
        setError("Voice input isn't supported in this browser. Try typing, or switch STT in settings.");
        return;
      }
      const recognizer = new WebSpeechRecognizer();
      recognizerRef.current = recognizer;
      setMicState("listening");
      recognizer.start({
        onPartial: (t) => setLiveTranscript(t),
        onFinal: (t) => {
          setLiveTranscript("");
          void send(t, { fromVoice: true });
        },
        onError: (m) => setError(m),
        onEnd: () => {
          setMicState("idle");
          recognizerRef.current = null;
        },
      });
    } else {
      // Fully-local STT (Moonshine/Whisper): record now, transcribe on stop.
      try {
        const recorder = new LocalRecorder(cfg.sttEngine);
        recorderRef.current = recorder;
        await recorder.start();
        setMicState("listening");
      } catch {
        setError("Couldn't access the microphone. Please allow mic permission.");
        setMicState("idle");
      }
    }
  }, [micState, send]);

  const stopListening = useCallback(async () => {
    const cfg = settingsRef.current;
    if (cfg.sttEngine === "webspeech") {
      recognizerRef.current?.stop();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) {
      setMicState("idle");
      return;
    }
    setMicState("transcribing");
    try {
      const text = await recorder.stopAndTranscribe();
      recorderRef.current = null;
      setMicState("idle");
      if (text) void send(text, { fromVoice: true });
      else setError("I didn't catch any speech — try again?");
    } catch (err) {
      console.error("[stt] local transcription failed:", err);
      recorderRef.current = null;
      setMicState("idle");
      setError("Local transcription failed. You can switch to the browser voice option in settings.");
    }
  }, [send]);

  // Keep the ref pointing at the latest startListening so the hands-free re-arm
  // in `send` always calls the current closure.
  startListeningRef.current = () => void startListening();

  const toggleMic = useCallback(() => {
    if (micState === "idle") void startListening();
    else if (micState === "listening") void stopListening();
    // (ignore taps while "transcribing")
  }, [micState, startListening, stopListening]);

  /** Enable/disable the hands-free auto-relisten loop (on only in voice view). */
  const setHandsFree = useCallback((on: boolean) => {
    handsFreeRef.current = on;
  }, []);

  /** Bail out of a recording without sending anything. */
  const cancelListening = useCallback(() => {
    recognizerRef.current?.abort();
    recognizerRef.current = null;
    recorderRef.current?.abort();
    recorderRef.current = null;
    setLiveTranscript("");
    setMicState("idle");
  }, []);

  // Warm up the Kokoro model in the background once we know we'll speak.
  const warmUp = useCallback(() => {
    if (settingsRef.current.textOnly || settingsRef.current.ttsEngine !== "kokoro") return;
    warmUpKokoro((p) => setTtsProgress(p));
  }, []);

  // Stop everything on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopSpeaking();
      recognizerRef.current?.abort();
      recorderRef.current?.abort();
    };
  }, []);

  return {
    products,
    messages,
    status,
    micState,
    micSupported,
    liveTranscript,
    error,
    setError,
    ttsProgress,
    catalogReady,
    settings,
    updateSettings,
    avatarFellBack,
    setAvatarFellBack,
    send,
    toggleMic,
    cancelListening,
    setHandsFree,
    startListening,
    warmUp,
    isMockMode,
  };
}
