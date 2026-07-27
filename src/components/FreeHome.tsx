/**
 * The free-plan home — what a signed-in account sees before subscribing.
 *
 * Free tier: the automated store audit, plus the upcoming product-hunt drop
 * (three winning product ideas for the store's niche). The operator dashboard
 * — chat, skills, recovery, retention, ops — unlocks with the Operator plan;
 * the paid APIs enforce the same boundary server-side (api/_plan.ts), so this
 * view is presentation, not the security gate.
 */
import { useState } from "react";
import { ButterflyIcon } from "./icons";
import { ConnectStore } from "./ConnectStore";
import { ToolsPanel } from "./ToolsPanel";
import { UpgradePanel } from "./UpgradePanel";
import { signOut } from "../lib/auth";
import { runAuditAsUser, type AuditReport, type ConnectedStore } from "../lib/store";

export function FreeHome({
  email,
  embedded,
  store,
  audit,
  initialUpgradeOpen,
  onConnected,
  onDisconnected,
  onAudit,
}: {
  email: string | null;
  embedded: boolean;
  store: ConnectedStore | null | undefined;
  audit: AuditReport | null;
  initialUpgradeOpen: boolean;
  onConnected: (store: ConnectedStore, audit: AuditReport | null) => void;
  onDisconnected: () => void;
  onAudit: (audit: AuditReport) => void;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(initialUpgradeOpen);
  const [storeOpen, setStoreOpen] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);

  const rerunAudit = async () => {
    if (!store || auditBusy) return;
    setAuditBusy(true);
    const fresh = await runAuditAsUser(store.url);
    if (fresh) onAudit(fresh);
    setAuditBusy(false);
  };

  return (
    <div className="app revealed">
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
            <p className="tagline">The AI operator for Shopify stores</p>
          </div>
        </div>
        <div className="header-right">
          <button type="button" className="tasks-btn" onClick={() => setStoreOpen((v) => !v)}>
            My store
          </button>
          {!embedded && email && (
            <>
              <span className="badge user" title="Signed in">{email}</span>
              <button type="button" className="link" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="free-home">
        <h2 className="free-title">Your free plan</h2>
        <p className="free-lede">
          The automated audit is yours free. Turn on your operator to put the
          automations to work on your store.
        </p>

        <div className="free-cards">
          <section className="card free-card">
            <h3>Store audit</h3>
            {store && audit ? (
              <>
                <p className="audit-score">{audit.score}<small>/100</small></p>
                <p className="free-card-body">{audit.summary}</p>
                {audit.findings.length > 0 && (
                  <ul className="plan-list">
                    {audit.findings.slice(0, 3).map((f) => (
                      <li key={f.id}>{f.title}</li>
                    ))}
                  </ul>
                )}
                <button type="button" className="primary" disabled={auditBusy} onClick={() => void rerunAudit()}>
                  {auditBusy ? "Auditing…" : "Re-run audit"}
                </button>
              </>
            ) : store ? (
              <>
                <p className="free-card-body">
                  Run the automated audit across six areas — see where you're
                  losing sales, ranked by dollar impact.
                </p>
                <button type="button" className="primary" disabled={auditBusy} onClick={() => void rerunAudit()}>
                  {auditBusy ? "Auditing…" : "Run your free audit"}
                </button>
              </>
            ) : (
              <p className="free-card-body">
                Connect your store to run the free automated audit.
              </p>
            )}
          </section>

          <section className="card free-card">
            <h3>
              Product hunt <span className="soon-badge">coming soon</span>
            </h3>
            <p className="free-card-body">
              Three winning product ideas for your niche, researched from live
              market data — landing in the free plan.
            </p>
          </section>

          <section className="card free-card featured">
            <h3>The Operator</h3>
            <p className="plan-price"><strong>$100</strong>/month · cancel anytime</p>
            <ul className="plan-list">
              <li>Automated cart recovery</li>
              <li>Automated customer retention</li>
              <li>Fulfillment operations dashboard</li>
              <li>Your AI operator, with approval on every action</li>
            </ul>
            <button type="button" className="primary" onClick={() => setUpgradeOpen(true)}>
              Start your operator
            </button>
          </section>
        </div>
      </main>

      <ToolsPanel
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        storeUrl={store?.url ?? null}
        onDisconnected={onDisconnected}
      />

      {/* Embedded installs are connected by construction — never show the
          connect card there. */}
      {store === null && !embedded && <ConnectStore onConnected={onConnected} />}

      <UpgradePanel
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        plan="free"
        email={email}
      />
    </div>
  );
}
