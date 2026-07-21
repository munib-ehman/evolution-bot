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
import { createSpeaker, stopSpeaking, warmUpVoice, DEFAULT_VOICE, type ModelProgress } from "../tts";
import { lat } from "../lib/latency";
import { WebSpeechRecognizer, webSpeechSupported } from "../stt/webSpeech";
import { LocalRecorder } from "../stt/transformersStt";
import { DEFAULT_AVATAR_URL } from "../avatar/constants";
import { loadJSON, saveJSON } from "../lib/storage";
import { hasWebSpeech, hasMicrophone } from "../lib/capabilities";
import { logChat } from "../lib/chatLog";
import { runSkill as requestSkillRun, SkillError } from "../llm/skillClient";
import { runAgentChat, AgentChatError } from "../llm/agentChatClient";
import { FILE_FIXES_SKILL_ID, type SkillChip } from "../lib/skills";

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

// How often the streaming reply is flushed into React state. Tokens can land
// at 100+/s; batching keeps re-renders (and the 3D scene) smooth.
const STREAM_PAINT_MS = 80;

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

  // Connected-store context (store URL + audit) injected into every turn's
  // system prompt. A ref so in-flight sends never read a stale closure.
  const storeContextRef = useRef<string | null>(null);
  const setStoreContext = useCallback((ctx: string | null) => {
    storeContextRef.current = ctx;
  }, []);

  /**
   * Drop a finished assistant message into the conversation from outside the
   * send loop — used when an ops-queue task completes and its result should
   * read like the operator reporting back.
   */
  const postAssistantMessage = useCallback(
    (content: string) => {
      appendMessage({ id: newId(), role: "assistant", content });
      logChat("assistant", content);
    },
    [appendMessage],
  );

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
      lat.begin(opts?.fromVoice ? "voice" : "text");

      const cfg = settingsRef.current;
      const history = [...messagesRef.current, userMsg];
      const speakable = !cfg.textOnly && cfg.ttsEngine !== "off";

      // Open the speaking session BEFORE the LLM call: tokens stream straight
      // into TTS as they arrive, so synthesis overlaps generation and the first
      // sentence is playing while the rest is still being written.
      const speaker = speakable
        ? createSpeaker(cfg.ttsEngine, {
            voice: cfg.voice,
            signal: controller.signal,
            onFirstAudio: () => {
              lat.mark("ttsFirstAudio");
              if (!controller.signal.aborted) setStatus("speaking");
            },
          })
        : null;

      // The reply bubble streams in as the model writes, batched so a fast
      // token stream doesn't thrash React (or starve the avatar's render loop).
      const assistantId = newId();
      let streamed = "";
      let bubbleShown = false;
      let paintTimer: number | null = null;
      const paint = () => {
        paintTimer = null;
        if (controller.signal.aborted) return;
        if (!bubbleShown) {
          bubbleShown = true;
          appendMessage({ id: assistantId, role: "assistant", content: streamed, pending: true });
        } else {
          // Tokens flowing — any agent "checking your data…" status is done.
          updateMessage(assistantId, { content: streamed, progress: undefined });
        }
      };

      const onToken = (t: string) => {
        if (controller.signal.aborted) return;
        if (streamed === "") lat.mark("llmFirstToken");
        streamed += t;
        speaker?.push(t);
        if (paintTimer === null) paintTimer = window.setTimeout(paint, STREAM_PAINT_MS);
      };

      // Agent tool runs happen before any token arrives; surface them as a
      // status line on the (pending) reply bubble, like the skill runs do.
      const onProgress = (label: string) => {
        if (controller.signal.aborted) return;
        if (!bubbleShown) {
          bubbleShown = true;
          appendMessage({ id: assistantId, role: "assistant", content: "", pending: true, progress: label });
        } else {
          updateMessage(assistantId, { progress: label });
        }
      };

      try {
        // Store connected → the agentic path: the model can pull real store
        // data itself. Falls back to the generic brain when the agent is
        // unavailable (no session, endpoint missing, store disconnected) —
        // but never after content already streamed (it would double-speak).
        let reply: string | null = null;
        if (storeContextRef.current !== null) {
          try {
            reply = await runAgentChat(history, {
              signal: controller.signal,
              onProgress,
              onToken,
            });
          } catch (err) {
            if (controller.signal.aborted) {
              speaker?.cancel();
              return;
            }
            if (err instanceof AgentChatError && err.streamedSomething) throw err;
            console.warn("[assistant] agent chat unavailable, using the generic brain:", err);
          }
        }
        if (reply === null) {
          reply = await getAssistantReply(history, products, {
            signal: controller.signal,
            extraContext: storeContextRef.current ?? undefined,
            onToken,
          });
        }
        lat.mark("llmDone");
        if (controller.signal.aborted) {
          speaker?.cancel();
          return;
        }

        // Final paint with the definitive text (covers non-streaming providers
        // where onToken fired once, and any trailing batched tokens).
        if (paintTimer !== null) window.clearTimeout(paintTimer);
        streamed = reply;
        paint();
        logChat("assistant", reply);

        if (speaker) {
          await speaker.finish();
          lat.mark("speakDone");
        }
        if (!controller.signal.aborted) updateMessage(assistantId, { pending: false, progress: undefined });

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
        speaker?.cancel();
        if (paintTimer !== null) window.clearTimeout(paintTimer);
        if (controller.signal.aborted) return;
        console.error("[assistant] reply failed:", err);
        const msg =
          err instanceof AgentChatError
            ? err.message
            : err instanceof Error && /LLM/.test(err.message)
              ? "I had trouble reaching my brain just now. You can keep chatting — I'll fall back to my built-in answers."
              : "Sorry, something went wrong. Mind trying that again?";
        setError(msg);
        // If the bubble already started streaming, keep what arrived; otherwise
        // surface the apology as its own message.
        if (bubbleShown) updateMessage(assistantId, { pending: false, progress: undefined });
        else appendMessage({ id: newId(), role: "assistant", content: msg });
      } finally {
        lat.report();
        if (!controller.signal.aborted) setStatus("idle");
      }
    },
    [appendMessage, updateMessage, products, status],
  );

  /**
   * Run a skill against the connected store — the agentic path. Parallel to
   * `send`, NOT through it: reports are long markdown that must never be
   * pushed into TTS, and the stream carries progress events.
   */
  const runSkillCore = useCallback(
    async (params: {
      skillId: string;
      kind: "agentic" | "concierge";
      taskTool: string;
      note?: string;
      userText: string;
      escalateNoteLabel?: string;
    }) => {
      if (status === "thinking") return;

      // Barge-in: stop speech and cancel any in-flight reply or run.
      stopSpeaking();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      appendMessage({ id: newId(), role: "user", content: params.userText });
      logChat("user", params.userText);
      setStatus("thinking");

      const assistantId = newId();
      appendMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        markdown: true,
        progress: "Starting…",
      });

      let streamed = "";
      let paintTimer: number | null = null;
      const paint = () => {
        paintTimer = null;
        if (controller.signal.aborted) return;
        updateMessage(assistantId, { content: streamed });
      };

      try {
        const result = await requestSkillRun(params.skillId, {
          note: params.note,
          taskTool: params.taskTool,
          signal: controller.signal,
          onProgress: (label) => {
            if (!controller.signal.aborted) updateMessage(assistantId, { progress: label });
          },
          onToken: (t) => {
            if (controller.signal.aborted) return;
            streamed += t;
            if (paintTimer === null) paintTimer = window.setTimeout(paint, STREAM_PAINT_MS);
          },
        });
        if (controller.signal.aborted) return;
        if (paintTimer !== null) window.clearTimeout(paintTimer);
        streamed = result.report;
        updateMessage(assistantId, {
          content: result.report,
          pending: false,
          progress: undefined,
          // Finished agentic reports carry the escalation action; the note
          // travels to the team verbatim, so make it self-contained.
          escalate:
            params.kind === "agentic"
              ? {
                  taskTool: params.taskTool,
                  note:
                    `The founder ran the "${params.escalateNoteLabel ?? params.skillId}" skill and asked the team to fix what it found.\n\nReport:\n` +
                    result.report.slice(0, 1500),
                }
              : undefined,
        });
        logChat("assistant", result.report);
      } catch (err) {
        if (paintTimer !== null) window.clearTimeout(paintTimer);
        if (controller.signal.aborted) return;
        console.error("[skill] run failed:", err);
        const msg =
          err instanceof SkillError && err.status === 401
            ? "Your session expired — sign in again to run skills."
            : err instanceof SkillError && err.status === 409
              ? "Connect your Shopify store first (Tasks → Connect Shopify) — skills run on your real store data."
              : err instanceof SkillError
                ? err.message
                : "That skill run failed. Mind trying again?";
        if (streamed) updateMessage(assistantId, { pending: false, progress: undefined });
        else updateMessage(assistantId, { content: msg, pending: false, progress: undefined, markdown: false });
        setError(msg);
      } finally {
        if (!controller.signal.aborted) setStatus("idle");
      }
    },
    [appendMessage, updateMessage, status],
  );

  /** Run one of the skill chips (the agentic store reports). */
  const runSkillFlow = useCallback(
    (chip: SkillChip) =>
      runSkillCore({
        skillId: chip.id,
        kind: chip.kind,
        taskTool: chip.taskTool,
        userText: chip.label,
        escalateNoteLabel: chip.label,
      }),
    [runSkillCore],
  );

  /** "Ask the team to fix this" under a report → file task + email the team. */
  const escalateToTeam = useCallback(
    (taskTool: string, note: string) =>
      runSkillCore({
        skillId: FILE_FIXES_SKILL_ID,
        kind: "concierge",
        taskTool,
        note,
        userText: "Ask the team to fix this",
      }),
    [runSkillCore],
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

  // Warm up the voice in the background once we know we'll speak: probes the
  // TTS backend (and pre-warms it), or starts the Kokoro download when the
  // app is running without a backend.
  const warmUp = useCallback(() => {
    if (settingsRef.current.textOnly || settingsRef.current.ttsEngine !== "kokoro") return;
    warmUpVoice((p) => setTtsProgress(p), settingsRef.current.voice);
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
    runSkillFlow,
    escalateToTeam,
    setStoreContext,
    postAssistantMessage,
    toggleMic,
    cancelListening,
    setHandsFree,
    startListening,
    warmUp,
    isMockMode,
  };
}
