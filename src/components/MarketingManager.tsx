import { useEffect, useState, type ReactNode } from "react";
import { formatMoney, getRecoveryCarts, type RecoveryData } from "../lib/recovery";
import { getRetentionCustomers, type RetentionData } from "../lib/retention";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";
import { getRecoveryCampaignHistory, observeRecoveryOpportunities } from "../lib/recoveryCampaigns";
import { getWinbackCampaignHistory } from "../lib/winbackCampaigns";
import { getBroadcastCampaignHistory } from "../lib/broadcastCampaigns";
import { getReviewCampaignHistory } from "../lib/reviewCampaigns";
import { getMarketingStatus, type MarketingActivity, type MarketingHealth } from "../lib/marketingDecisions";

type LoadState = "idle" | "loading" | "ready" | "error";
type Focus = "recovery" | "customers" | "delivery" | "campaign";
type NodeState = "checking" | "clear" | "attention" | "blocked" | "available";

function NodeIcon({ kind }: { kind: Focus }) {
  if (kind === "recovery") return <svg viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20.5 8H6.1M10 20h.01M17 20h.01"/></svg>;
  if (kind === "customers") return <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (kind === "delivery") return <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 7l8 6 8-6"/></svg>;
  return <svg viewBox="0 0 24 24"><path d="m3 11 18-5-5 18-4-8-9-5ZM12 16l4-4"/></svg>;
}

export function MarketingManager({ active, agentVisual, agentReply, storeUrl, onAsk, onOpenStore, onOpenRecovery, onOpenWinback, onOpenDelivery, onOpenBroadcast, onOpenAutopilot }: {
  active: boolean; agentVisual: ReactNode; agentReply?: string; onAsk: (prompt: string) => void; onOpenRecovery: (section: "monitoring" | "emails" | "revenue") => void;
  storeUrl: string | null; onOpenStore: () => void; onOpenWinback: (section: "winback" | "reviews" | "lapse") => void; onOpenDelivery: () => void; onOpenBroadcast: (section: "workflow") => void; onOpenAutopilot:()=>void;
}) {
  const [state, setState] = useState<LoadState>("idle");
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [retention, setRetention] = useState<RetentionData | null>(null);
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);
  const [focus, setFocus] = useState<Focus>("customers");
  const [drillFocus, setDrillFocus] = useState<Focus | null>(null);
  const [approvals,setApprovals]=useState({recovery:false,winback:false,reviews:false,broadcast:false});
  const [agentStates,setAgentStates]=useState<Partial<Record<MarketingActivity["kind"],string>>>({});
  const [agentHealth,setAgentHealth]=useState<MarketingHealth|null>(null);

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

  useEffect(()=>{if(!active)return;const refresh=()=>{void observeRecoveryOpportunities().catch(()=>undefined).then(()=>Promise.allSettled([getRecoveryCampaignHistory(),getWinbackCampaignHistory(),getReviewCampaignHistory(),getBroadcastCampaignHistory(),getMarketingStatus()])).then(([recoveryRows,winbackRows,reviewRows,broadcastRows,canonical])=>{setApprovals({recovery:recoveryRows.status==="fulfilled"&&recoveryRows.value.some(row=>row.status==="proposed"),winback:winbackRows.status==="fulfilled"&&winbackRows.value.some(row=>row.status==="proposed"),reviews:reviewRows.status==="fulfilled"&&reviewRows.value.some(row=>row.status==="proposed"),broadcast:broadcastRows.status==="fulfilled"&&broadcastRows.value.some(row=>row.status==="proposed")});if(canonical.status==="fulfilled"){const next:Partial<Record<MarketingActivity["kind"],string>>={};for(const activity of canonical.value.activities)if(!next[activity.kind])next[activity.kind]=activity.status;setAgentStates(next);setAgentHealth(canonical.value.health);}});};refresh();const timer=window.setInterval(refresh,60_000);window.addEventListener("evolution:recovery-campaign-changed",refresh);window.addEventListener("evolution:broadcast-campaign-changed",refresh);return()=>{window.clearInterval(timer);window.removeEventListener("evolution:recovery-campaign-changed",refresh);window.removeEventListener("evolution:broadcast-campaign-changed",refresh);};},[active]);

  useEffect(() => {
    const update = (event: Event) => setDelivery((event as CustomEvent<EmailDeliverySettings | null>).detail);
    window.addEventListener("evolution:delivery-settings", update);
    return () => window.removeEventListener("evolution:delivery-settings", update);
  }, []);

  const recoveryValue = recovery?.carts.reduce((sum, cart) => sum + cart.totalPrice, 0) ?? 0;
  const lapsedValue = retention?.lapsed.reduce((sum, customer) => sum + customer.totalSpent, 0) ?? 0;
  const currency = recovery?.currency ?? retention?.currency ?? "USD";
  const loading = state === "idle" || state === "loading";
  const cartCount = recovery?.carts.length ?? 0;
  const lapsedCount = retention?.lapsed.length ?? 0;
  const deliveryStatus = delivery?.status;
  // Worker health belongs to the manager/root. Capability nodes must only
  // advertise an action when that capability has a real actionable state.
  const nodeState=(kind:MarketingActivity["kind"],fallback:NodeState):NodeState=>{const status=agentStates[kind];if(status==="blocked"||status==="failed")return"blocked";if(status==="proposed")return"attention";if(status==="scheduled"||status==="executing")return"checking";return fallback;};
  const retentionState=():NodeState=>{const winback=nodeState("winback",approvals.winback?"attention":"clear"),review=nodeState("review",approvals.reviews?"attention":"clear");return winback==="blocked"||review==="blocked"?"blocked":winback==="attention"||review==="attention"?"attention":winback==="checking"||review==="checking"?"checking":"clear";};
  const items: Record<Focus, { label: string; eyebrow: string; value: string; detail: string; open: () => void; steps: string[]; features: { label: string; state: NodeState }[]; state: NodeState; stateLabel: string; cta: string }> = {
    recovery: cartCount > 0
      ? { label: "Cart recovery", eyebrow: "Recover revenue", value: formatMoney(recoveryValue, currency), detail: `${cartCount} checkouts can be recovered`, open: () => onOpenRecovery("monitoring"), steps: ["Abandoned carts detected", "Recovery value estimated", "Campaign prepared automatically"], features:[{label:"Checkout monitoring",state:nodeState("recovery","clear")},{label:"Recovery emails",state:nodeState("recovery",approvals.recovery?"attention":"clear")},{label:"Revenue tracking",state:nodeState("recovery","clear")}], state: loading ? "checking" : nodeState("recovery",approvals.recovery?"attention":"clear"), stateLabel: nodeState("recovery",approvals.recovery?"attention":"clear")==="blocked"?"Action required":agentStates.recovery==="scheduled"||agentStates.recovery==="executing"?"Agent executing":approvals.recovery?"Approval requested":"Agent monitoring", cta: "View recovery" }
      : { label: "Cart recovery", eyebrow: "Recover revenue", value: "All clear", detail: "No eligible abandoned checkouts right now", open: () => onOpenRecovery("monitoring"), steps: ["Checkout activity scanned", "Eligibility checked", "No action needed"], features:[{label:"Checkout monitoring",state:nodeState("recovery","clear")},{label:"Recovery emails",state:nodeState("recovery","clear")},{label:"Revenue tracking",state:nodeState("recovery","clear")}], state: loading ? "checking" : nodeState("recovery","clear"), stateLabel: nodeState("recovery","clear")==="blocked"?"Action required":"Check complete", cta: "View details" },
    customers: lapsedCount > 0
      ? { label: "Customer retention", eyebrow: "Grow relationships", value: `${lapsedCount} customers`, detail: `${formatMoney(lapsedValue, currency)} in historical customer value`, open: () => onOpenWinback("winback"), steps: ["Lapsed customers detected", "Contact eligibility checked", "Activities prepared automatically"], features:[{label:"Win-back audiences",state:nodeState("winback",approvals.winback?"attention":"clear")},{label:"Review requests",state:nodeState("review",approvals.reviews?"attention":"clear")},{label:"Lapse detection",state:"clear"}], state: loading ? "checking" : retentionState(), stateLabel: retentionState()==="blocked"?"Action required":retentionState()==="checking"?"Agent executing":retentionState()==="attention"?"Approval requested":"Agent monitoring", cta: "View activity" }
      : { label: "Customer retention", eyebrow: "Grow relationships", value: "All clear", detail: "No customers currently qualify for win-back", open: () => onOpenWinback("winback"), steps: ["Customer activity scanned", "Eligibility checked", "No action needed"], features:[{label:"Win-back audiences",state:nodeState("winback","clear")},{label:"Review requests",state:nodeState("review","available")},{label:"Lapse detection",state:retentionState()}], state: loading ? "checking" : retentionState(), stateLabel: retentionState()==="blocked"?"Action required":retentionState()==="attention"?"Approval requested":retentionState()==="checking"?"Agent executing":"Check complete", cta: "View customers" },
    delivery: delivery?.status === "ready"
      ? { label: "Email operations", eyebrow: "Deliver reliably", value: "Ready", detail: "Evolution email delivery is active", open: onOpenDelivery, steps: ["Evolution sender enabled", "Private test passed", "Delivery active"], features:[], state: loading ? "checking" : "clear", stateLabel: "Email active", cta: "View delivery" }
      : { label: "Email operations", eyebrow: "Deliver reliably", value: "Setup required", detail: "Campaigns cannot send until Evolution email is enabled", open: onOpenDelivery, steps: ["Evolution sender checked", "Private test required", "Setup required before send"], features:[], state: loading ? "checking" : "blocked", stateLabel: deliveryStatus === "test_required" ? "Test required" : "Email not connected", cta: "Enable email" },
    campaign: { label: "Campaign studio", eyebrow: "Create demand", value: approvals.broadcast?"Approval ready":"Monitoring", detail: approvals.broadcast?"Evolution prepared a campaign":"Evolution is evaluating consented audiences", open: () => onOpenBroadcast("workflow"), steps: ["Opportunity detected", "Audience and message selected", "Approve before anything sends"], features:[], state: nodeState("broadcast",approvals.broadcast?"attention":"clear"), stateLabel: nodeState("broadcast",approvals.broadcast?"attention":"clear")==="blocked"?"Action required":agentStates.broadcast==="scheduled"||agentStates.broadcast==="executing"?"Agent executing":approvals.broadcast?"Approval requested":"Agent monitoring", cta: "View activity" },
  };
  const selected = items[focus];
  const openFeature = (kind: Focus, label: string) => {
    if (kind === "recovery") {
      const section = label === "Recovery emails" ? "emails" : label === "Revenue tracking" ? "revenue" : "monitoring";
      onOpenRecovery(section);
      return;
    }
    if (kind === "customers") {
      onOpenWinback(label === "Review requests" ? "reviews" : label === "Lapse detection" ? "lapse" : "winback");
      return;
    }
    items[kind].open();
  };
  const stateMark: Record<NodeState, string> = { checking: "·", clear: "✓", attention: "!", blocked: "!", available: "+" };
  const stateText: Record<NodeState, string> = { checking: "Checking", clear: "Okay", attention: "Review needed", blocked: "Action required", available: "Available" };

  return <div className={`marketing-manager evolution-live focus-${focus}`}>
    <header className="live-head"><div><span>Marketing manager</span><h2>Agent workspace</h2></div></header>
    <div className="agent-canvas">
      <div className={`capability-tree ${drillFocus ? `drilled drill-${drillFocus}` : "overview"}`}>
        {drillFocus && <button type="button" className="tree-back" onClick={() => setDrillFocus(null)} aria-label="Return to capability overview"><span>×</span><small>All capabilities</small></button>}
        <div className="tree-world">
          <button type="button" className={`store-source ${storeUrl ? "connected" : "disconnected"}`} onClick={onOpenStore} aria-label={storeUrl ? "Shopify store connected. Open store settings" : "Connect a Shopify store"}>
            <span className="shopify-mark">S</span><span><small>{storeUrl ? "Live data source" : "Data source required"}</small><strong>{storeUrl ? "Shopify connected" : "Connect Shopify"}</strong></span><i>{storeUrl ? "✓" : "+"}</i>
          </button>
          <button type="button" className={`tree-root ${agentHealth&&!agentHealth.workerHealthy?"state-blocked":""}`} onClick={onOpenAutopilot} aria-label={agentHealth&&!agentHealth.workerHealthy?"Background worker needs attention. Open Autopilot":"Marketing manager is monitoring automatically. Open Autopilot"}><span className="root-spark">✦</span><span><small>{agentHealth&&!agentHealth.workerHealthy?"Background worker needs attention":"Monitoring automatically"}</small><strong>Marketing manager</strong></span></button>
          <svg className="tree-lines" viewBox="0 0 760 430" preserveAspectRatio="none" aria-hidden="true">
            <path className="source-line" d="M380 58V86"/>
            <path className="root-branch line-recovery" d="M380 150C380 192 95 184 95 230"/><path className="root-branch line-customers" d="M380 150C380 192 285 184 285 230"/><path className="root-branch line-delivery" d="M380 150C380 192 475 184 475 230"/><path className="root-branch line-campaign" d="M380 150C380 192 665 184 665 230"/>
            <circle className="data-pulse source-pulse" r="3"><animateMotion path="M380 58V86" dur="2.2s" begin="-.8s" repeatCount="indefinite"/></circle>
            <circle className="data-pulse branch-pulse pulse-recovery" r="3"><animateMotion path="M380 150C380 192 95 184 95 230" dur="4.8s" begin="-1.1s" repeatCount="indefinite"/></circle>
            <circle className="data-pulse branch-pulse pulse-customers" r="3"><animateMotion path="M380 150C380 192 285 184 285 230" dur="4.1s" begin="-2.7s" repeatCount="indefinite"/></circle>
            <circle className="data-pulse branch-pulse pulse-delivery" r="3"><animateMotion path="M380 150C380 192 475 184 475 230" dur="4.5s" begin="-3.4s" repeatCount="indefinite"/></circle>
            <circle className="data-pulse branch-pulse pulse-campaign" r="3"><animateMotion path="M380 150C380 192 665 184 665 230" dur="5.2s" begin="-.5s" repeatCount="indefinite"/></circle>
          </svg>
          <div className="capability-grid">
            {(Object.keys(items) as Focus[]).map((kind) => <section key={kind} className={`capability-branch branch-${kind} state-${items[kind].state} ${drillFocus === kind ? "active" : ""} ${!drillFocus ? "scanning" : ""}`}>
              <button type="button" className="capability-node" onClick={() => {
                setFocus(kind);
                if (kind === "delivery" || kind === "campaign") {
                  setDrillFocus(null);
                  items[kind].open();
                  return;
                }
                setDrillFocus(kind);
              }} aria-pressed={drillFocus === kind}>
                <span className="node-icon"><NodeIcon kind={kind}/></span><span className="node-copy"><small>{items[kind].eyebrow}</small><b>{items[kind].label}</b></span><span className={`node-check ${items[kind].state}`}>{stateMark[items[kind].state]}</span>
              </button>
              <span className="branch-status"><i/>{items[kind].stateLabel}</span>
              {kind !== "delivery" && kind !== "campaign" && <div className="feature-branch"><svg className="child-lines" viewBox="0 0 480 82" preserveAspectRatio="none" aria-hidden="true"><path d="M240 0C240 34 80 25 80 82"/><path d="M240 0V82"/><path d="M240 0C240 34 400 25 400 82"/><circle className="data-pulse" r="2.5"><animateMotion path="M240 0C240 34 80 25 80 82" dur="3.8s" begin="-1.4s" repeatCount="indefinite"/></circle><circle className="data-pulse pulse-b" r="2.5"><animateMotion path="M240 0V82" dur="3.4s" begin="-2.6s" repeatCount="indefinite"/></circle><circle className="data-pulse pulse-c" r="2.5"><animateMotion path="M240 0C240 34 400 25 400 82" dur="4.1s" begin="-.7s" repeatCount="indefinite"/></circle></svg>{items[kind].features.map(feature=><button type="button" className={`leaf-${feature.state}`} key={feature.label} aria-label={`${feature.label}: ${stateText[feature.state]}`} onClick={() => { setFocus(kind); openFeature(kind, feature.label); }}><span>{feature.label}</span><i>{stateMark[feature.state]}</i></button>)}</div>}
            </section>)}
          </div>
        </div>
      </div>
      <div className="live-avatar">{agentVisual}</div>
      <div className="live-speech"><span className="speech-mark">✦</span><p>{agentReply || (loading ? "I’m mapping your store signals now." : selected.state === "clear" ? `${selected.label} is clear. Nothing needs action.` : selected.state === "blocked" ? `${selected.label} needs setup before I can continue.` : selected.state === "attention" ? `I found something in ${selected.label.toLowerCase()} that needs review.` : `${selected.label} is ready when you need it.`)}</p></div>
    </div>
  </div>;
}
