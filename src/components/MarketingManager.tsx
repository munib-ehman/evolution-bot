import { useEffect, useState } from "react";
import { formatMoney, getRecoveryCarts, type RecoveryData } from "../lib/recovery";
import { getRetentionCustomers, type RetentionData } from "../lib/retention";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";

type LoadState = "idle" | "loading" | "ready" | "error";

export function MarketingManager({ active, onAsk, onOpenRecovery, onOpenWinback, onOpenDelivery, onOpenBroadcast }: {
  active: boolean;
  onAsk: (prompt: string) => void;
  onOpenRecovery: () => void;
  onOpenWinback: () => void;
  onOpenDelivery: () => void;
  onOpenBroadcast: () => void;
}) {
  const [state, setState] = useState<LoadState>("idle");
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [retention, setRetention] = useState<RetentionData | null>(null);
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);

  useEffect(() => {
    if (!active || state !== "idle") return;
    setState("loading");
    void Promise.allSettled([getRecoveryCarts(), getRetentionCustomers(), getEmailDeliverySettings()]).then(([carts, customers, deliveryResult]) => {
      if (carts.status === "fulfilled") setRecovery(carts.value);
      if (customers.status === "fulfilled") setRetention(customers.value);
      if (deliveryResult.status === "fulfilled") setDelivery(deliveryResult.value);
      setState(carts.status === "rejected" && customers.status === "rejected" ? "error" : "ready");
    });
  }, [active, state]);

  useEffect(() => {
    const update = (event: Event) => setDelivery((event as CustomEvent<EmailDeliverySettings | null>).detail);
    window.addEventListener("evolution:delivery-settings", update);
    return () => window.removeEventListener("evolution:delivery-settings", update);
  }, []);

  const recoveryValue = recovery?.carts.reduce((sum, cart) => sum + cart.totalPrice, 0) ?? 0;
  const lapsedValue = retention?.lapsed.reduce((sum, customer) => sum + customer.totalSpent, 0) ?? 0;
  const currency = recovery?.currency ?? retention?.currency ?? "USD";
  const bestOpportunity = recoveryValue > 0
    ? `${formatMoney(recoveryValue, currency)} is currently sitting in ${recovery?.carts.length ?? 0} recoverable carts.`
    : (retention?.lapsed.length ?? 0) > 0
      ? `${retention?.lapsed.length ?? 0} lapsed customers represent ${formatMoney(lapsedValue, currency)} in past spend.`
      : "Your manager is watching for the next eligible revenue opportunity.";

  return <div className="marketing-manager">
    <header className="manager-hero">
      <div><span className="manager-kicker">AI role · active</span><h2>Marketing Manager</h2><p>Owns lifecycle email revenue—finding opportunities, preparing campaigns, and learning from results.</p></div>
      <span className="manager-status"><i /> Monitoring store</span>
    </header>
    <section className="manager-priority">
      <div><span>Today’s priority</span><strong>{state === "loading" ? "Reading your store…" : bestOpportunity}</strong></div>
      <button type="button" className="primary" onClick={() => onAsk("Find my best email marketing opportunity right now and tell me what campaign you recommend.")}>Ask manager</button>
    </section>
    {state === "error" && <p className="manager-notice">I couldn’t load the marketing snapshot. Check the Shopify connection or ask me in chat to retry.</p>}
    <div className="manager-metrics" aria-label="Marketing opportunities">
      <article><span>Recoverable carts</span><strong>{recovery ? recovery.carts.length : "—"}</strong><small>{recovery ? formatMoney(recoveryValue, currency) : state === "error" ? "Unavailable" : "Loading opportunity"}</small></article>
      <article><span>Win-back audience</span><strong>{retention ? retention.lapsed.length : "—"}</strong><small>{retention ? `${formatMoney(lapsedValue, currency)} past spend` : state === "error" ? "Unavailable" : "Loading audience"}</small></article>
      <article><span>Email allowance</span><strong>400</strong><small>Beta monthly ceiling</small></article>
    </div>
    <section className="manager-workflows">
      <div className="manager-section-head"><div><span>Responsibilities</span><h3>Email programs</h3></div><button type="button" className="link" onClick={onOpenDelivery}>{delivery?.status === "ready" ? `Sending as ${delivery.senderName}` : delivery?.status === "pending" ? "Finish DNS verification" : delivery?.status === "test_required" ? "Send a test first" : "Set up branded delivery"}</button></div>
      <article className="workflow-card">
        <div className="workflow-icon">01</div><div><h4>Abandoned cart recovery</h4><p>Three-touch, purchase-aware recovery built from live checkouts.</p></div><span className="workflow-state ready">Ready to draft</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenRecovery}>Manage recovery</button><button type="button" onClick={() => onAsk("Create a three-email abandoned checkout recovery campaign without a discount. Use my live store data and show me the plan before anything is sent.")}>Build in chat</button></div>
      </article>
      <article className={`workflow-card ${retention ? "" : "workflow-disabled"}`}>
        <div className="workflow-icon">02</div><div><h4>Win-back campaigns</h4><p>Find valuable customers going quiet, choose the right incentive, and bring them back.</p></div><span className={`workflow-state ${retention ? "ready" : "setup"}`}>{retention ? `${retention.lapsed.length} eligible` : "Needs Shopify data"}</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenWinback}>Plan campaign</button><button type="button" disabled={!retention} onClick={() => onAsk("Build a win-back campaign for my best eligible lapsed-customer segment. Explain why this audience matters, recommend whether an offer is needed, and draft the emails for approval.")}>Ask manager to recommend</button></div>
      </article>
      <article className={`workflow-card ${retention ? "" : "workflow-disabled"}`}>
        <div className="workflow-icon">03</div><div><h4>One-time email campaign</h4><p>Send a consent-safe launch, promotion, or announcement to a selected customer segment.</p></div><span className={`workflow-state ${delivery?.status === "ready" ? "ready" : "setup"}`}>{delivery?.status === "ready" ? "Ready to plan" : "Delivery setup"}</span>
        <div className="workflow-actions"><button type="button" className="link" onClick={onOpenBroadcast}>Plan campaign</button><button type="button" disabled={!retention} onClick={() => onAsk("Recommend a one-time email campaign based on my store and customer data. Explain the audience and angle, but do not send anything.")}>Ask manager to recommend</button></div>
      </article>
    </section>
    <p className="manager-safety">Chat and buttons use the same guarded actions. Evolution can analyze and draft freely; sending, scheduling, enabling an automation, or increasing an incentive always requires structured approval.</p>
  </div>;
}
