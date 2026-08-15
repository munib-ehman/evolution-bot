import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { Splash } from "./components/Splash";
import { ButterflyIcon, MicIcon, StopIcon, CloseIcon, KeyboardIcon, VolumeIcon, VolumeOffIcon } from "./components/icons";
import { useAssistant } from "./hooks/useAssistant";
import { useAuthEmail } from "./components/AuthGate";
import { authEnabled, signOut } from "./lib/auth";
import { looksLowPowered } from "./lib/capabilities";
import { loadJSON, saveJSON } from "./lib/storage";
import { speechEngine } from "./audio/speechEngine";
import { ConnectStore } from "./components/ConnectStore";
import { ToolsPanel } from "./components/ToolsPanel";
import { RecoveryPanel } from "./components/RecoveryPanel";
import { WinbackPanel } from "./components/WinbackPanel";
import { OpsPanel } from "./components/OpsPanel";
import { ActionCenter } from "./components/ActionCenter";
import { LiveToasts } from "./components/LiveToasts";
import { UpgradePanel } from "./components/UpgradePanel";
import { FreeHome } from "./components/FreeHome";
import { AdminQueue, isAdmin } from "./components/AdminQueue";
import { buildStoreContext } from "./llm/systemPrompt";
import { ensureProfile, getLatestAudit, getPlan, getStore, getStoreCatalog, runAuditAsUser, type AuditReport, type ConnectedStore, type Plan, type StoreCatalog } from "./lib/store";
import { isEmbedded } from "./lib/embedded";
import { consumeUpgradeIntent } from "./lib/upgradeIntent";
import { SKILL_CHIPS, type SkillChip } from "./lib/skills";
import { MarketingManager } from "./components/MarketingManager";
import { EmailDeliveryPanel } from "./components/EmailDeliveryPanel";
import { BroadcastCampaignPanel } from "./components/BroadcastCampaignPanel";
import { SeoManager } from "./components/SeoManager";
import { CustomerSuccessManager } from "./components/CustomerSuccessManager";
import { RetentionPanel } from "./components/RetentionPanel";
import { SupportPanel } from "./components/SupportPanel";

const AvatarScene = lazy(() => import("./avatar/AvatarScene").then(module => ({ default: module.AvatarScene })));

type View = "marketing" | "customer-success" | "seo" | "voice" | "chat";
// New key intentionally migrates existing users into the role-first workspace.
const VIEW_KEY = "shop-avatar-role-view-v2";

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
const MARKETING_STARTERS = [
  "Find my best marketing opportunity",
  "Build a cart recovery campaign",
  "Create a win-back campaign",
];
const SEO_STARTERS = [
  "Audit my product SEO",
  "Find my biggest AI search opportunity",
  "Which product should I optimize for SEO first?",
];
const CUSTOMER_SUCCESS_STARTERS = [
  "Find my most urgent customer issue",
  "Who should I ask for a review?",
  "Which customers are at risk?",
];

export default function App() {
  const a = useAssistant();
  const authEmail = useAuthEmail();
  const embedded = isEmbedded();
  const warmedRef = useRef(false);

  // ── The shell: connected store, plan, audit, panels ───────────────────────
  // store: undefined = still loading, null = signed in but not connected yet.
  const [store, setStore] = useState<ConnectedStore | null | undefined>(undefined);
  // null = still loading — the paywall must not flash the wrong side.
  const [plan, setPlan] = useState<Plan | null>(null);
  // Pricing-page CTA (?upgrade=1) auto-opens the upgrade panel on arrival.
  const [wantUpgrade, setWantUpgrade] = useState(false);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  // The live product list (names + prices) that grounds the chat copilot.
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [customerQueueOpen, setCustomerQueueOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  // A freshly persisted Shopify proposal belongs in the approval inbox. Open
  // it immediately so the merchant never has to hunt for an invisible card.
  useEffect(() => {
    if (a.actionRevision === 0) return;
    setTasksOpen(false);
    setRecoveryOpen(false);
    setRetentionOpen(false);
    setOpsOpen(false);
    setSupportOpen(false);
    setDeliveryOpen(false);
    setBroadcastOpen(false);
    setActionsOpen(true);
  }, [a.actionRevision]);

  // The pricing CTA must open billing for non-gated accounts too (operators
  // revisiting, admins whose profile row is still free) — FreeHome handles
  // the gated case via initialUpgradeOpen.
  useEffect(() => {
    if (wantUpgrade) setUpgradeOpen(true);
  }, [wantUpgrade]);

  useEffect(() => {
    if (!authEnabled || !authEmail) return;
    ensureProfile();
    void (async () => {
      const [s, p, latest, cat] = await Promise.all([
        getStore(),
        getPlan(),
        getLatestAudit(),
        getStoreCatalog(),
      ]);
      setStore(s);
      setPlan(p);
      setAudit(latest);
      setCatalog(cat);

      // Returning from the Shopify OAuth loop: re-run the audit with the
      // fresh connection so the deep findings land immediately.
      const params = new URLSearchParams(window.location.search);
      const shopifyResult = params.get("shopify");
      const upgradeResult = params.get("upgrade");
      if (shopifyResult || upgradeResult) {
        history.replaceState(null, "", window.location.pathname + window.location.hash);
      }
      // The param survives a same-tab arrival; the parked localStorage intent
      // survives the magic-link login round trip that strips the query.
      if (upgradeResult === "1" || consumeUpgradeIntent()) setWantUpgrade(true);
      // Back from Polar checkout: the subscription.active webhook flips the
      // plan asynchronously — poll briefly so the app unlocks on its own.
      if (upgradeResult === "success" && p !== "operator") {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const fresh = await getPlan();
          if (fresh === "operator") {
            setPlan(fresh);
            break;
          }
        }
      }
      if (shopifyResult === "connected") {
        const target = s?.url ?? params.get("shop");
        const fresh = target ? await runAuditAsUser(target) : null;
        if (fresh) {
          setAudit(fresh);
          const stats = fresh.stats;
          a.postAssistantMessage(
            stats
              ? `Shopify is connected — I can see your real numbers now. Last 30 days: ${stats.orders30} orders, ${stats.abandoned30} abandoned checkouts. I can also prepare store changes for your approval.`
              : "Shopify is connected! I re-ran your audit with deeper access. I can prepare store changes, and nothing is applied until you approve it.",
          );
        } else {
          a.postAssistantMessage("Shopify is connected! Your next audit will use your real store data.");
        }
        const freshStore = await getStore();
        if (freshStore) setStore(freshStore);
        // The connection just landed — the catalog fetch above likely 409'd.
        setCatalog(await getStoreCatalog());
      } else if (shopifyResult === "error") {
        const reason = params.get("reason");
        const detail = reason === "token-exchange"
          ? "Shopify rejected the access-token exchange. Reopen the app from Shopify Admin after this deployment."
          : reason === "save"
            ? "Shopify approved access, but saving the connection failed. Check that the Shopify token migrations are applied."
            : reason === "bad-state"
              ? "The connection session expired or was opened in another tab. Start Reconnect again and finish it in the same tab."
              : reason === "bad-hmac"
                ? "Shopify's callback signature did not match the deployed client secret."
                : reason === "not-configured" || reason === "no-db"
                  ? "The deployed Shopify or database environment variables are incomplete."
                  : "The connection callback was incomplete or rejected.";
        a.postAssistantMessage(
          `Shopify connection failed: ${detail}`,
        );
      }
    })();
  }, [authEmail]);

  // Keep the copilot grounded in the founder's real store + audit findings.
  useEffect(() => {
    a.setStoreContext(store ? buildStoreContext(store.url, store.platform, audit, catalog) : null);
  }, [store, audit, catalog, a.setStoreContext]);

  const handleDisconnected = () => {
    setStore(null);
    setAudit(null);
    setCatalog(null);
    setTasksOpen(false);
    setRetentionOpen(false);
    setOpsOpen(false);
    setActionsOpen(false);
    a.postAssistantMessage(
      "Your store is disconnected — I no longer have any access to it. Connect this or a different store whenever you're ready and I'll take a fresh look.",
    );
  };

  const handleConnected = (s: ConnectedStore, fresh: AuditReport | null) => {
    setStore(s);
    if (fresh) setAudit(fresh);
    void getStoreCatalog().then(setCatalog);
    a.postAssistantMessage(
      fresh
        ? `Your store is connected! I ran your audit: ${fresh.score} out of 100. ${fresh.summary} Ask me anything, or ask me to prepare a concrete store change for your approval.`
        : "Your store is connected! Ask me anything, or ask me to prepare a concrete store change for your approval.",
    );
  };


  // Role workspace is the default; voice and full chat remain available.
  // The choice is remembered across visits.
  const [view, setViewState] = useState<View>(() => {
    const saved = loadJSON<{ view?: string }>(VIEW_KEY, { view: "marketing" }).view;
    return saved === "voice" || saved === "chat" || saved === "marketing" || saved === "customer-success" || saved === "seo" ? saved : "marketing";
  });
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

  // The paywall: signed-in accounts without the Operator plan only get the
  // free view (audit + product hunt) — the server enforces the same boundary
  // on every paid API (api/_plan.ts). Admins bypass for internal ops.
  const gatedFree = authEnabled && !!authEmail && !isAdmin(authEmail) && plan !== "operator";

  // Pre-warm the (heavy) Kokoro voice as soon as the app reveals. Behind the
  // login gate every visitor is a committed lead, so the model download starts
  // while they read the greeting instead of stalling their first reply.
  // (After the splash, so it never competes with the avatar for bandwidth.)
  // Never for gated accounts — the free view has no voice to warm.
  useEffect(() => {
    if (reveal && !gatedFree) ensureWarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, gatedFree]);

  const handleSend = (text: string) => {
    // Unlock audio during the actual user gesture (before any await) so the
    // browser's autoplay policy lets the first spoken reply play.
    void speechEngine.unlock();
    ensureWarm();
    a.send(text, { manager: view === "marketing" || view === "customer-success" || view === "seo" ? view : undefined });
  };
  const handleMarketingAsk = (text: string) => {
    setChatOpen(true);
    handleSend(text);
  };
  const handleMic = () => {
    void speechEngine.unlock();
    ensureWarm();
    a.toggleMic();
  };

  // Skill runs live in the chat view — reports are read, not spoken. From the
  // voice stage a chip first glides over to chat (mic safely off), then runs.
  const skillsAvailable = store != null;
  const handleSkill = (chip: SkillChip) => {
    a.cancelListening();
    setView("chat");
    void a.runSkillFlow(chip);
  };

  const voiceEnabled = !a.settings.textOnly && a.settings.ttsEngine !== "off";
  const canTalk = voiceEnabled && a.micSupported;
  // Voice stage needs a working mic — otherwise fall back to chat gracefully.
  const voiceView = view === "voice" && canTalk;
  const marketingView = view === "marketing";
  const customerSuccessView = view === "customer-success";
  const seoView = view === "seo";
  const managerView = marketingView || customerSuccessView || seoView;

  useEffect(() => {
    if (marketingView) a.setManagerContext("marketing");
    else if (customerSuccessView) a.setManagerContext("customer-success");
    else if (seoView) a.setManagerContext("seo");
  }, [marketingView, customerSuccessView, seoView, a.setManagerContext]);

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

  // Internal ops queue at /app#/admin. The email check is routing only —
  // the admin RLS policies are the real gate (non-admins get zero rows).
  if (location.hash === "#/admin" && isAdmin(authEmail)) {
    return <AdminQueue />;
  }

  if (gatedFree) {
    // Plan still loading — hold the splash rather than flash the wrong view.
    if (plan === null) return <Splash leaving={false} ready={false} />;
    return (
      <FreeHome
        email={authEmail}
        embedded={embedded}
        store={store}
        audit={audit}
        initialUpgradeOpen={wantUpgrade}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onAudit={setAudit}
      />
    );
  }

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
            {store && (
              <button type="button" className={`tasks-btn ${marketingView ? "active" : ""}`} onClick={() => setView("marketing")}>
                Marketing Manager
              </button>
            )}
            {store && (
              <button type="button" className={`tasks-btn ${customerSuccessView ? "active" : ""}`} onClick={() => setView("customer-success")}>
                Customer Success Manager
              </button>
            )}
            {store && (
              <button type="button" className={`tasks-btn ${seoView ? "active" : ""}`} onClick={() => setView("seo")}>
                SEO Manager
              </button>
            )}
            {store && managerView && !chatOpen && (
              <button type="button" className="tasks-btn" onClick={() => setChatOpen(true)}>
                Open chat
              </button>
            )}
            <button
              type="button"
              className={`tasks-btn sound-toggle ${a.settings.ttsEngine === "off" || a.settings.textOnly ? "muted" : ""}`}
              onClick={a.toggleSound}
              aria-label={a.settings.ttsEngine === "off" || a.settings.textOnly ? "Enable spoken replies" : "Mute spoken replies"}
              title={a.settings.ttsEngine === "off" || a.settings.textOnly ? "Turn sound on" : "Turn sound off"}
            >
              {a.settings.ttsEngine === "off" || a.settings.textOnly ? <VolumeOffIcon size={17} /> : <VolumeIcon size={17} />}
              <span>{a.settings.ttsEngine === "off" || a.settings.textOnly ? "Sound off" : "Sound on"}</span>
            </button>
            {store && (
              <button type="button" className="tasks-btn" onClick={() => { setTasksOpen(false); setActionsOpen(false); setOpsOpen(false); setRecoveryOpen(false); setRetentionOpen(false); setDeliveryOpen((v) => !v); }}>
                Email setup
              </button>
            )}
            {store && (
              <button
                type="button"
                className="tasks-btn"
                onClick={() => {
                  setTasksOpen(false);
                  setRetentionOpen(false);
                  setRecoveryOpen(false);
                  setOpsOpen(false);
                  setActionsOpen((v) => !v);
                }}
              >
                Actions
              </button>
            )}
            {store && (
              <button
                type="button"
                className="tasks-btn"
                onClick={() => {
                  setTasksOpen(false);
                  setActionsOpen(false);
                  setRetentionOpen(false);
                  setRecoveryOpen(false);
                  setOpsOpen((v) => !v);
                }}
              >
                Ops
              </button>
            )}
            <button
              type="button"
              className="tasks-btn"
              onClick={() => {
                setRecoveryOpen(false);
                setActionsOpen(false);
                setRetentionOpen(false);
                setOpsOpen(false);
                setTasksOpen((v) => !v);
              }}
            >
              My store
            </button>
            <button
              type="button"
              className="tasks-btn"
              onClick={() => {
                setTasksOpen(false);
                setActionsOpen(false);
                setRecoveryOpen(false);
                setRetentionOpen(false);
                setOpsOpen(false);
                setUpgradeOpen(true);
              }}
            >
              {plan === "operator" ? "Plan" : "Upgrade"}
            </button>
            {/* Inside the Shopify admin the install IS the login — no email
                identity to show, and signing out would just strand the iframe. */}
            {!embedded && (
              <>
                <span className="badge user" title="Signed in">{authEmail}</span>
                <button type="button" className="link" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <main className={`layout ${voiceView ? "solo" : ""} ${managerView ? "manager-layout" : ""} ${managerView && !chatOpen ? "chat-closed" : ""}`}>
        {/* ── 3D avatar stage ───────────────────────────────────────────── */}
        <section className={`stage card ${managerView ? "manager-stage" : ""}`}>
          {marketingView ? (
            <MarketingManager
              active={marketingView}
              onAsk={handleMarketingAsk}
              onOpenRecovery={() => {
                setRetentionOpen(false);
                setBroadcastOpen(false);
                setRecoveryOpen(true);
              }}
              onOpenWinback={() => {
                setRecoveryOpen(false);
                setBroadcastOpen(false);
                setRetentionOpen(true);
              }}
              onOpenDelivery={() => { setBroadcastOpen(false); setDeliveryOpen(true); }}
              onOpenBroadcast={() => { setRecoveryOpen(false); setRetentionOpen(false); setBroadcastOpen(true); }}
            />
          ) : customerSuccessView ? (
            <CustomerSuccessManager
              active={customerSuccessView}
              onAsk={handleMarketingAsk}
              onOpenSupport={() => setSupportOpen(true)}
              onOpenReviews={() => setCustomerQueueOpen(true)}
              onOpenRetention={() => setCustomerQueueOpen(true)}
            />
          ) : seoView ? (
            <SeoManager active={seoView} onAsk={handleMarketingAsk} onProposal={(action) => {
              setActionsOpen(true);
              a.postAssistantMessage(`Your SEO update is ready for review: ${action.summary}. Open Actions to compare the current listing with the suggested version before approving it.`);
            }}/>
          ) : <Suspense fallback={<div className="avatar-loading" aria-label="Loading avatar" />}><AvatarScene
            avatarUrl={a.settings.avatarUrl}
            thinking={thinking}
            speaking={a.status === "speaking"}
            framing={voiceView ? "stage" : "portrait"}
            onAvatarFallback={() => a.setAvatarFellBack(true)}
            onReady={() => setAvatarReady(true)}
          /></Suspense>}

          {!managerView && <div className={`status-pill ${statusState}`}>
            <span className="pulse" />
            {statusLabel}
          </div>}

          {!managerView && warming && (
            <div className="warmup" role="status">
              Warming up the voice… {Math.round((a.ttsProgress?.progress ?? 0) * 100)}%
              <span className="warmup-note">First visit only — it's cached after this.</span>
            </div>
          )}

          {!managerView && a.avatarFellBack && (
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

              {/* Starter prompts — the first screen invites a real task. With
                   a store connected, they become the agentic skill chips. */}
              {a.messages.length <= 1 && a.status === "idle" && a.micState === "idle" && (
                <div className="suggestions on-stage" aria-label="Suggested questions">
                  {skillsAvailable
                    ? SKILL_CHIPS.map((c) => (
                        <button key={c.id} type="button" className="chip" title={c.blurb} onClick={() => handleSkill(c)}>
                          {c.label}
                        </button>
                      ))
                    : STARTERS.map((s) => (
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
        <section className={`chat card ${voiceView || (managerView && !chatOpen) ? "hidden" : ""}`} aria-hidden={voiceView || (managerView && !chatOpen)}>
            {managerView && (
              <div className="chat-toolbar">
                <div><strong>Chat with your manager</strong><span>Ask, edit, approve, or pause work</span></div>
                <button type="button" className="chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">×</button>
              </div>
            )}
            <MessageList
              messages={a.messages}
              status={a.status}
              onEscalate={(taskTool, note) => void a.escalateToTeam(taskTool, note)}
            />

            {/* Starter prompts — fill the empty first screen with useful taps.
                 With a store connected, they become the agentic skill chips. */}
            {a.messages.length <= 1 && a.status === "idle" && (
              <div className="suggestions" aria-label="Suggested questions">
                {marketingView
                  ? MARKETING_STARTERS.map((s) => (
                      <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                        {s}
                      </button>
                    ))
                  : customerSuccessView
                  ? CUSTOMER_SUCCESS_STARTERS.map((s) => (
                      <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                        {s}
                      </button>
                    ))
                  : seoView
                  ? SEO_STARTERS.map((s) => (
                      <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                        {s}
                      </button>
                    ))
                  : skillsAvailable
                  ? SKILL_CHIPS.map((c) => (
                      <button key={c.id} type="button" className="chip" title={c.blurb} onClick={() => handleSkill(c)}>
                        {c.label}
                      </button>
                    ))
                  : STARTERS.map((s) => (
                      <button key={s} type="button" className="chip" onClick={() => handleSend(s)}>
                        {s}
                      </button>
                    ))}
              </div>
            )}

            {/* Skills stay one tap away after the conversation has started. */}
            {skillsAvailable && !managerView && a.messages.length > 1 && (
              <div className="skills-row" aria-label="Skills">
                {SKILL_CHIPS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip small"
                    title={c.blurb}
                    disabled={a.status === "thinking"}
                    onClick={() => handleSkill(c)}
                  >
                    {c.label}
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

      {/* ── The shell: store panel, onboarding, and billing ─────────────── */}
      {authEmail && (
        <ToolsPanel
          open={tasksOpen}
          onClose={() => setTasksOpen(false)}
          storeUrl={store?.url ?? null}
          onDisconnected={handleDisconnected}
          onStoreUpdated={handleConnected}
        />
      )}

      {authEmail && store && (
        <RecoveryPanel
          open={recoveryOpen}
          onClose={() => setRecoveryOpen(false)}
          storeName={store.url.replace(/^https?:\/\//, "").replace(/\.myshopify\.com.*$/, "").replace(/\/.*$/, "")}
        />
      )}

      {authEmail && store && (
        <WinbackPanel
          open={retentionOpen}
          onClose={() => setRetentionOpen(false)}
          onBuild={handleMarketingAsk}
        />
      )}

      {authEmail && store && <OpsPanel open={opsOpen} onClose={() => setOpsOpen(false)} />}
      {authEmail && store && <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} onOpenDelivery={() => { setSupportOpen(false); setDeliveryOpen(true); }} />}
      {authEmail && store && <RetentionPanel open={customerQueueOpen} onClose={() => setCustomerQueueOpen(false)} storeName={store.url.replace(/^https?:\/\//, "").replace(/\.myshopify\.com.*$/, "").replace(/\/.*$/, "")} storeUrl={store.url} />}
      {authEmail && store && <ActionCenter open={actionsOpen} onClose={() => setActionsOpen(false)} />}
      {authEmail && store && <EmailDeliveryPanel open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />}
      {authEmail && store && <BroadcastCampaignPanel open={broadcastOpen} onClose={() => setBroadcastOpen(false)} onOpenDelivery={() => { setBroadcastOpen(false); setDeliveryOpen(true); }} />}
      {authEmail && store && <LiveToasts />}

      {/* Embedded installs are connected by construction (the session
          endpoint created the store row) — never show the connect card there.
          Nor over the billing panel: whoever came to buy sees packages first. */}
      {authEnabled && authEmail && store === null && splashGone && !embedded && !upgradeOpen && (
        <ConnectStore onConnected={handleConnected} />
      )}

      <UpgradePanel
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        plan={plan ?? "free"}
        email={authEmail}
      />

      {!splashGone && <Splash leaving={reveal} ready={ready} />}
    </div>
  );
}
