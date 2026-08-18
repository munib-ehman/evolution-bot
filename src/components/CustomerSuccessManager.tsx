import { useEffect, useState } from "react";
import { getOpsSnapshot, type OpsSnapshot } from "../lib/ops";
import { formatMoney, getRetentionCustomers, type RetentionData } from "../lib/retention";

type LoadState = "idle" | "loading" | "ready" | "error";

export function CustomerSuccessManager({ active, onAsk, onOpenSupport, onOpenReviews, onOpenRetention }: {
  active: boolean;
  onAsk: (prompt: string) => void;
  onOpenSupport: () => void;
  onOpenReviews: () => void;
  onOpenRetention: () => void;
}) {
  const [state, setState] = useState<LoadState>("idle");
  const [retention, setRetention] = useState<RetentionData | null>(null);
  const [ops, setOps] = useState<OpsSnapshot | null>(null);

  useEffect(() => {
    if (!active || state !== "idle") return;
    setState("loading");
    void Promise.allSettled([getRetentionCustomers(), getOpsSnapshot()]).then(([customers, operations]) => {
      if (customers.status === "fulfilled") setRetention(customers.value);
      if (operations.status === "fulfilled") setOps(operations.value);
      setState(customers.status === "rejected" && operations.status === "rejected" ? "error" : "ready");
    });
  }, [active, state]);

  const now = Date.now();
  const overdue = ops?.shipQueue.filter(order => now - Date.parse(order.createdAt) >= 48 * 60 * 60 * 1000) ?? [];
  const reviewAudience = retention?.buyers.length ?? 0;
  const atRisk = retention?.lapsed.length ?? 0;
  const atRiskValue = retention?.lapsed.reduce((sum, customer) => sum + customer.totalSpent, 0) ?? 0;
  const currency = retention?.currency ?? ops?.currency ?? "USD";
  const priority = overdue.length > 0
    ? `${overdue.length} order${overdue.length === 1 ? " has" : "s have"} waited more than 48 hours and may need proactive support.`
    : reviewAudience > 0
      ? `${reviewAudience} recent buyer${reviewAudience === 1 ? " is" : "s are"} ready for a thoughtful review request.`
      : atRisk > 0
        ? `${atRisk} customer${atRisk === 1 ? " is" : "s are"} at risk of not returning.`
        : state === "error"
          ? "Customer and order signals are unavailable right now."
          : "No urgent customer-success opportunity is visible in the current Shopify data.";

  return <div className="marketing-manager customer-success-manager">
    <header className="manager-hero">
      <div><span className="manager-kicker">AI role · active</span><h2>Customer Success Manager</h2><p>Protects customer relationships—resolving risks, generating reviews, and encouraging repeat purchases.</p></div>
      <span className="manager-status"><i /> Monitoring customers</span>
    </header>
    <section className="manager-priority">
      <div><span>Today’s priority</span><strong>{state === "loading" ? "Reading customer and order signals…" : priority}</strong></div>
      <button type="button" className="primary" disabled={state !== "ready"} onClick={() => onAsk("Find my highest-priority customer success opportunity right now using live order and customer data.")}>{state === "error" ? "Data unavailable" : "Ask manager"}</button>
    </section>
    {state === "error" && <p className="manager-notice">I couldn’t load the customer-success snapshot. Check the Shopify connection or ask me in chat to retry.</p>}
    <div className="manager-metrics" aria-label="Customer success opportunities">
      <article><span>Support risks</span><strong>{ops ? overdue.length : "—"}</strong><small>{ops ? "Orders unfulfilled for 48+ hours" : "Order data unavailable"}</small></article>
      <article><span>Review audience</span><strong>{retention ? reviewAudience : "—"}</strong><small>{retention ? "Successfully fulfilled 7–30 days ago" : "Fulfillment data unavailable"}</small></article>
      <article><span>At-risk customers</span><strong>{retention ? atRisk : "—"}</strong><small>{retention ? `${formatMoney(atRiskValue, currency)} past spend` : "Loading retention signals"}</small></article>
    </div>
    <section className="manager-workflows">
      <div className="manager-section-head"><div><span>Responsibilities</span><h3>Customer programs</h3></div><small>Shopify-derived signals</small></div>
      <article className="workflow-card">
        <div className="workflow-icon">01</div><div><h4>Customer support</h4><p>Investigate fulfillment risks, confirm the next action, then prepare a fact-based reply.</p></div><span className={`workflow-state ${overdue.length ? "setup" : "ready"}`}>{!ops ? "Unavailable" : overdue.length ? `${overdue.length} need attention` : "No urgent risks"}</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenSupport}>Open support queue</button><button type="button" onClick={onOpenSupport}>Investigate &amp; notify</button></div>
      </article>
      <article className="workflow-card">
        <div className="workflow-icon">02</div><div><h4>Review generation</h4><p>Select successfully fulfilled orders and prepare personalized, honest review requests.</p></div><span className="workflow-state ready">{retention ? `${reviewAudience} eligible` : "Unavailable"}</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenReviews}>Open reviews & retention</button><button type="button" disabled={!retention} onClick={() => onAsk("Analyze my eligible fulfilled-order review audience using only the verified products in the retention snapshot. Recommend a respectful review-request approach. Nothing should be sent.")}>Ask manager</button></div>
      </article>
      <article className="workflow-card">
        <div className="workflow-icon">03</div><div><h4>Customer retention</h4><p>Identify valuable customers going quiet and recommend the right next action.</p></div><span className="workflow-state ready">{retention ? `${atRisk} at risk` : "Unavailable"}</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenRetention}>Open retention queue</button><button type="button" onClick={() => onAsk("Analyze my at-risk customers and recommend a retention action. Keep it customer-success focused and do not send anything.")}>Ask manager</button></div>
      </article>
    </section>
    <p className="manager-safety">Customer support emails use your verified sender and require approval of the exact message. Evolution rechecks Shopify before sending and blocks duplicate notifications.</p>
  </div>;
}
