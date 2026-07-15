import { useEffect, useRef, useState } from "react";
import { AvatarScene } from "./avatar/AvatarScene";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { Splash } from "./components/Splash";
import { ButterflyIcon, MicIcon, StopIcon, CloseIcon, KeyboardIcon } from "./components/icons";
import { useAssistant } from "./hooks/useAssistant";
import { useAuthEmail } from "./components/AuthGate";
import { signOut } from "./lib/auth";
import { looksLowPowered } from "./lib/capabilities";
import { loadJSON, saveJSON } from "./lib/storage";
import { speechEngine } from "./audio/speechEngine";

type View = "voice" | "chat";
const VIEW_KEY = "shop-avatar-view";

// Splash never flashes by (min), and never traps the user if the model stalls (max).
const MIN_SPLASH_MS = 1600;
const MAX_SPLASH_MS = 9000;

// First-visit starter prompts — every one is answerable by the built-in mock
// brain, so they work before any LLM key is configured.
const STARTERS = [
  "Show me the catalog",
  "What's our best budget pick?",
  "What's our premium product?",
];

export default function App() {
  const a = useAssistant();
  const authEmail = useAuthEmail();
  const warmedRef = useRef(false);

  // Two experiences: an immersive voice stage (default) and a classic chat.
  // The choice is remembered across visits.
  const [view, setViewState] = useState<View>(() => loadJSON<{ view: View }>(VIEW_KEY, { view: "voice" }).view);
  const setView = (v: View) => {
    setViewState(v);
    saveJSON(VIEW_KEY, { view: v });
  };

  // ── Boot splash → reveal choreography ──────────────────────────────────────
  const [avatarReady, setAvatarReady] = useState(false);
  const [reveal, setReveal] = useState(false); // splash fading, app animating in
  const [splashGone, setSplashGone] = useState(false); // splash fully unmounted
  const mountAtRef = useRef(performance.now());
  const ready = avatarReady && a.catalogReady;

  // Once loaded, hold the splash for a graceful minimum, then begin the reveal.
  useEffect(() => {
    if (!ready || reveal) return;
    const elapsed = performance.now() - mountAtRef.current;
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    const id = setTimeout(() => setReveal(true), wait);
    return () => clearTimeout(id);
  }, [ready, reveal]);

  // Safety net: never hang on the splash even if the model never signals ready.
  useEffect(() => {
    const id = setTimeout(() => setReveal(true), MAX_SPLASH_MS);
    return () => clearTimeout(id);
  }, []);

  // Unmount the splash after its fade-out finishes.
  useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => setSplashGone(true), 800);
    return () => clearTimeout(id);
  }, [reveal]);

  // Gentle one-time suggestion to switch to a lighter mode on weak devices.
  const [lowPowerNote, setLowPowerNote] = useState(false);
  useEffect(() => {
    if (looksLowPowered() && a.settings.ttsEngine === "kokoro" && !a.settings.textOnly) {
      setLowPowerNote(true);
    }
  }, [a.settings.ttsEngine, a.settings.textOnly]);

  const ensureWarm = () => {
    if (!warmedRef.current) {
      warmedRef.current = true;
      a.warmUp();
    }
  };

  // Pre-warm the (heavy) Kokoro voice as soon as the app reveals. Behind the
  // login gate every visitor is a committed lead, so the model download starts
  // while they read the greeting instead of stalling their first reply.
  // (After the splash, so it never competes with the avatar for bandwidth.)
  useEffect(() => {
    if (reveal) ensureWarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const handleSend = (text: string) => {
    // Unlock audio during the actual user gesture (before any await) so the
    // browser's autoplay policy lets the first spoken reply play.
    void speechEngine.unlock();
    ensureWarm();
    a.send(text);
  };
  const handleMic = () => {
    void speechEngine.unlock();
    ensureWarm();
    a.toggleMic();
  };

  const voiceEnabled = !a.settings.textOnly && a.settings.ttsEngine !== "off";
  const canTalk = voiceEnabled && a.micSupported;
  // Voice stage needs a working mic — otherwise fall back to chat gracefully.
  const voiceView = view === "voice" && canTalk;

  // Hands-free auto-relisten belongs to the voice stage only.
  useEffect(() => {
    a.setHandsFree(voiceView);
  }, [voiceView, a.setHandsFree]);
  const warming =
    a.ttsProgress !== null && a.ttsProgress.progress !== null && a.ttsProgress.progress < 0.999;

  const thinking = a.status === "thinking";
  const statusLabel =
    a.status === "thinking"
      ? "Thinking…"
      : a.status === "speaking"
        ? "Speaking…"
        : a.micState === "listening"
          ? "Listening…"
          : a.micState === "transcribing"
            ? "Transcribing…"
            : "Ready";
  const statusState = thinking
    ? "thinking"
    : a.status === "speaking"
      ? "speaking"
      : a.micState;

  // Voice-stage caption: your words while you speak, then Evolution's reply —
  // the conversation lives on the stage, no transcript needed.
  const listening = a.micState === "listening";
  const lastAssistant = [...a.messages].filter((m) => m.role === "assistant").pop();
  const caption =
    a.micState === "transcribing"
      ? "Got it — one sec…"
      : thinking
        ? "Thinking…"
        : (lastAssistant?.content ?? "");

  return (
    <div className={`app ${reveal ? "revealed" : "booting"}`}>
      {/* Warm, slowly-drifting aurora — the Evolution "alive" background. */}
      <div className="aurora" aria-hidden="true">
        <span className="aura aura-a" />
        <span className="aura aura-b" />
      </div>

      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <ButterflyIcon size={22} />
          </span>
          <div>
            <h1 className="wordmark">Evolution</h1>
            <p className="tagline">The AI COO for your ecommerce store</p>
          </div>
        </div>

        {authEmail && (
          <div className="header-right">
            <span className="badge user" title="Signed in">{authEmail}</span>
            <button type="button" className="link" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className={`layout ${voiceView ? "solo" : ""}`}>
        {/* ── 3D avatar stage ───────────────────────────────────────────── */}
        <section className="stage card">
          <AvatarScene
            avatarUrl={a.settings.avatarUrl}
            thinking={thinking}
            speaking={a.status === "speaking"}
            framing={voiceView ? "stage" : "portrait"}
            onAvatarFallback={() => a.setAvatarFellBack(true)}
            onReady={() => setAvatarReady(true)}
          />

          <div className={`status-pill ${statusState}`}>
            <span className="pulse" />
            {statusLabel}
          </div>

          {warming && (
            <div className="warmup" role="status">
              Warming up the voice… {Math.round((a.ttsProgress?.progress ?? 0) * 100)}%
              <span className="warmup-note">First visit only — it's cached after this.</span>
            </div>
          )}

          {a.avatarFellBack && (
            <div className="corner-note">
              Using the built-in avatar (couldn't load the Ready Player Me model).
            </div>
          )}

          {/* ── Voice experience: captions + orb, overlaid on the stage ── */}
          {voiceView && (
            <div className="voice-layer">
              {a.error ? (
                <div className="error-toast" role="alert">
                  {a.error}
                  <button className="link" onClick={() => a.setError(null)}>
                    dismiss
                  </button>
                </div>
              ) : (
                (listening || caption) && (
                  <div className={`caption ${listening ? "interim" : ""}`} aria-live="polite">
                    {listening && (
                      <span className="eq" aria-hidden="true">
                        <span /><span /><span /><span /><span />
                      </span>
                    )}
                    <span className="caption-text">
                      {listening ? a.liveTranscript || "Listening… just speak" : caption}
                    </span>
                  </div>
                )
              )}

              {/* Starter prompts — the first screen invites a real task. */}
              {a.messages.length <= 1 && a.status === "idle" && a.micState === "idle" && (
                <div className="suggestions on-stage" aria-label="Suggested questions">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="voice-dock">
                <button
                  type="button"
                  className={`dock-btn cancel ${listening ? "" : "ghosted"}`}
                  onClick={a.cancelListening}
                  tabIndex={listening ? 0 : -1}
                  aria-hidden={!listening}
                  aria-label="Cancel recording"
                  title="Cancel"
                >
                  <CloseIcon size={18} />
                </button>

                <button
                  type="button"
                  className={`orb ${a.micState} ${thinking ? "busy" : ""}`}
                  onClick={handleMic}
                  disabled={thinking || a.micState === "transcribing"}
                  aria-label={listening ? "Finish and send" : "Tap to talk"}
                  title={listening ? "Finish and send" : "Tap to talk"}
                >
                  <span className="orb-ring" aria-hidden="true" />
                  {listening ? <StopIcon size={28} /> : <MicIcon size={28} />}
                </button>

                <button
                  type="button"
                  className="dock-btn"
                  onClick={() => {
                    // Leaving the voice stage must never leave the mic hot.
                    a.cancelListening();
                    setView("chat");
                  }}
                  aria-label="Switch to typing"
                  title="Type instead"
                >
                  <KeyboardIcon size={18} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Chat experience: an always-mounted panel that slides in over the
             right of the stage while the camera glides the model left. ───── */}
        <section className={`chat card ${voiceView ? "hidden" : ""}`} aria-hidden={voiceView}>
            <MessageList messages={a.messages} status={a.status} />

            {/* Starter prompts — fill the empty first screen with useful taps. */}
            {a.messages.length <= 1 && a.status === "idle" && (
              <div className="suggestions" aria-label="Suggested questions">
                {STARTERS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {lowPowerNote && (
              <div className="inline-note">
                This device looks modest — voice may take a moment to warm up.
                <button className="link" onClick={() => setLowPowerNote(false)}>
                  dismiss
                </button>
              </div>
            )}

            {a.error && (
              <div className="error-toast" role="alert">
                {a.error}
                <button className="link" onClick={() => a.setError(null)}>
                  dismiss
                </button>
              </div>
            )}

            <Composer
              onSend={handleSend}
              disabled={a.status === "thinking"}
              canTalk={canTalk}
              active={!voiceView}
              onVoice={() => {
                setView("voice");
                handleMic();
              }}
            />
          </section>
      </main>

      {!splashGone && <Splash leaving={reveal} ready={ready} />}
    </div>
  );
}
