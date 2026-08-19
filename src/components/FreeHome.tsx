/**
 * The free-plan home — what a signed-in account sees before subscribing.
 *
 * Free tier: the automated store audit, plus a live product hunt
 * (three winning product ideas for the store's niche). The operator dashboard
 * — chat, skills, recovery, retention, ops — unlocks with the Operator plan;
 * the paid APIs enforce the same boundary server-side (api/_plan.ts), so this
 * view is presentation, not the security gate.
 */
import { useState } from "react";
import { ButterflyIcon } from "./icons";
import { ConnectStore } from "./ConnectStore";
import { ProductHunt } from "./ProductHunt";
import { ToolsPanel } from "./ToolsPanel";
import { UpgradePanel } from "./UpgradePanel";
import { signOut } from "../lib/auth";
import { EMPTY_ENTITLEMENTS, runAuditAsUserVerbose, type AuditReport, type ConnectedStore } from "../lib/store";

// Same severity ladder as the public audit page (impact is a 1–5 scale).
const severityLabel = (impact: number) =>
  impact >= 5 ? "critical" : impact >= 4 ? "high impact" : impact >= 3 ? "medium" : "worth fixing";
const severityClass = (impact: number) =>
  impact >= 5 ? "crit" : impact >= 4 ? "high" : impact >= 3 ? "med" : "low";

const money = (n: number, currency: string | null) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
};

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
  const chooserKey = email ? `evolution-plan-chooser-seen:${email.toLowerCase()}` : "";
  const [upgradeOpen, setUpgradeOpen] = useState(() => {
    if (initialUpgradeOpen) return true;
    try { return Boolean(chooserKey && localStorage.getItem(chooserKey) !== "1"); }
    catch { return false; }
  });
  const [storeOpen, setStoreOpen] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const rerunAudit = async () => {
    if (!store || auditBusy) return;
    setAuditBusy(true);
    setAuditError(null);
    const { report, error } = await runAuditAsUserVerbose(store.url);
    if (report) onAudit(report);
    else setAuditError(error ?? "The audit couldn't run — give it another try in a minute.");
    setAuditBusy(false);
  };

  return (
    <div className="app free-shell revealed">
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
          <button type="button" className="tasks-btn" onClick={() => setUpgradeOpen(true)}>
            Upgrade
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
        <section className="free-hero">
          <span className="free-kicker">Free plan</span>
          <h2 className="free-title">Your store, one upgrade away</h2>
          <p className="free-lede">
            The automated audit is yours free, forever. Turn on your operator
            when you're ready to put the automations to work.
          </p>
        </section>

        <div className="free-layout">
          <div className="free-stack">
            <section className="card free-card">
              <div className="free-card-head">
                <h3>Store audit</h3>
                <span className="tier-badge free">Included free</span>
              </div>
              {store && audit ? (
                <>
                  <div className="audit-row">
                    <p className="audit-score">{audit.score}<small>/100</small></p>
                    <p className="free-card-body">{audit.summary}</p>
                  </div>

                  {audit.stats && (
                    <div className="stat-grid">
                      <div className="stat">
                        <span>{audit.stats.orders30}</span>
                        <label>orders · 30d</label>
                      </div>
                      <div className="stat">
                        <span>{money(audit.stats.revenue30, audit.stats.currency)}</span>
                        <label>revenue · 30d</label>
                      </div>
                      {audit.stats.aov != null && (
                        <div className="stat">
                          <span>{money(audit.stats.aov, audit.stats.currency)}</span>
                          <label>avg. order</label>
                        </div>
                      )}
                      {audit.stats.repeatRate != null && (
                        <div className="stat">
                          <span>
                            {Math.round(audit.stats.repeatRate <= 1 ? audit.stats.repeatRate * 100 : audit.stats.repeatRate)}%
                          </span>
                          <label>repeat buyers</label>
                        </div>
                      )}
                      <div className="stat alert">
                        <span>{money(audit.stats.abandonedValue30, audit.stats.currency)}</span>
                        <label>{audit.stats.abandoned30} abandoned carts</label>
                      </div>
                    </div>
                  )}

                  {/* Public scan: real catalog numbers from /products.json. */}
                  {!audit.stats && audit.catalog && (
                    <div className="stat-grid">
                      <div className="stat">
                        <span>{audit.catalog.products}{audit.catalog.capped ? "+" : ""}</span>
                        <label>products scanned</label>
                      </div>
                      {audit.catalog.soldOut > 0 && (
                        <div className="stat alert">
                          <span>{audit.catalog.soldOut}</span>
                          <label>sold out</label>
                        </div>
                      )}
                      {audit.catalog.thinDescriptions > 0 && (
                        <div className="stat alert">
                          <span>{audit.catalog.thinDescriptions}</span>
                          <label>thin descriptions</label>
                        </div>
                      )}
                      {audit.catalog.avgImages != null && (
                        <div className="stat">
                          <span>{audit.catalog.avgImages}</span>
                          <label>photos / product</label>
                        </div>
                      )}
                      {audit.catalog.priceMin != null && audit.catalog.priceMax != null && (
                        <div className="stat">
                          <span>
                            {Math.round(audit.catalog.priceMin).toLocaleString()}–{Math.round(audit.catalog.priceMax).toLocaleString()}
                          </span>
                          <label>price range</label>
                        </div>
                      )}
                    </div>
                  )}

                  {audit.scanned && audit.scanned.pages.length > 0 && (
                    <p className="scan-receipts">
                      Scanned {audit.scanned.pages.join(" · ")}
                      {audit.scanned.detected.length > 0 &&
                        ` — detected ${audit.scanned.detected.join(", ")}`}
                      .
                    </p>
                  )}

                  {/* The page-by-page table: every URL the crawl fetched. */}
                  {audit.pages && audit.pages.length > 0 && (
                    <div className="page-audits">
                      <h4>Page-by-page</h4>
                      {audit.pages.map((p) => (
                        <div className="page-audit" key={p.path}>
                          <a
                            href={`${audit.storeUrl}${p.path === "/" ? "" : p.path}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {p.path}
                          </a>
                          {p.issues.length > 0 ? (
                            <span className="page-issues">{p.issues.join(" · ")}</span>
                          ) : (
                            <span className="page-clean">✓ no issues found</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {audit.findings.length > 0 ? (
                    <div className="audit-findings">
                      {audit.findings.map((f) => (
                        <article className="audit-finding" key={f.id}>
                          <h4>
                            {f.title}
                            <span className={`sev ${severityClass(f.impact)}`}>{severityLabel(f.impact)}</span>
                          </h4>
                          <p>{f.detail}</p>
                          {f.evidence && f.evidence.length > 0 && (
                            <p className="evidence">e.g. {f.evidence.join(" · ")}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="free-card-body">
                      No obvious leaks from the outside.{" "}
                      {!audit.connected &&
                        "The Operator plan connects your Shopify data for the deeper checks — abandoned carts, retention, profit."}
                    </p>
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
              {auditError && <p className="overlay-error">{auditError}</p>}
            </section>

            <ProductHunt storeUrl={store?.url ?? null} />
          </div>

          <aside className="card operator-card">
            <span className="operator-badge">Choose your manager</span>
            <p className="plan-price"><strong>$50</strong>/manager/month</p>
            <p className="operator-tag">Start with the role your store needs now.</p>
            <ul className="operator-list">
              <li>Marketing Manager</li>
              <li>Customer Success Manager</li>
              <li>SEO Manager</li>
              <li>Product Manager</li>
              <li>Operations Manager</li>
            </ul>
            <button type="button" className="primary big" onClick={() => setUpgradeOpen(true)}>
              Choose a manager
            </button>
            <p className="operator-fineprint">
              Instant access · cancel anytime · 14-day money-back guarantee
            </p>
          </aside>
        </div>
      </main>

      <ToolsPanel
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        storeUrl={store?.url ?? null}
        onDisconnected={onDisconnected}
        onStoreUpdated={onConnected}
        shopifyConnect={false}
      />

      {/* Embedded installs are connected by construction — never show the
          connect card there. And someone who arrived to buy (upgrade panel
          open) sees the packages first; the connect card waits its turn. */}
      {store === null && !embedded && !upgradeOpen && <ConnectStore onConnected={onConnected} />}

      <UpgradePanel
        open={upgradeOpen}
        onClose={() => {
          setUpgradeOpen(false);
          try { if (chooserKey) localStorage.setItem(chooserKey, "1"); } catch { /* storage unavailable */ }
        }}
        plan="free"
        email={email}
        entitlements={EMPTY_ENTITLEMENTS}
        selectedRole="marketing"
      />
    </div>
  );
}
