import { useEffect, useState } from "react";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";
import { formatMoney, getRetentionCustomers, renderWinback, type LapsedCustomer } from "../lib/retention";
import { winbackCampaignAction, type WinbackCampaignProposal } from "../lib/winbackCampaigns";

type Decision = "proposed" | "approved" | "paused" | "rejected";

export function WinbackApprovalCard({ proposal }: { proposal: WinbackCampaignProposal }) {
  const [customers, setCustomers] = useState<LapsedCustomer[]>([]);
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);
  const [decision, setDecision] = useState<Decision>("proposed");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scheduled?: number; sentNow?: number; testMode?: boolean } | null>(null);

  useEffect(() => {
    void getRetentionCustomers().then((data) => setCustomers(data.lapsed)).catch(() => setError("Customer previews could not be refreshed."));
    void getEmailDeliverySettings().then(setDelivery).catch(() => setDelivery(null));
  }, [proposal.id]);

  const decide = async (action: "approve" | "reject" | "pause" | "resume") => {
    if (busy) return;
    if (action === "approve" && delivery?.status !== "ready") { setError("Complete Email setup and send a successful test before scheduling."); return; }
    const message = action === "approve" ? `Approve and schedule two emails for ${proposal.customerCount} lapsed customers? The first email is due now.` : action === "reject" ? "Reject this campaign?" : action === "pause" ? "Pause future win-back emails?" : "Resume the remaining win-back emails?";
    if (!window.confirm(message)) return;
    setBusy(true); setError(null);
    try {
      const next = await winbackCampaignAction(proposal.id, action);
      setDecision(action === "approve" || action === "resume" ? "approved" : action === "pause" ? "paused" : "rejected");
      setResult(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Campaign action failed."); }
    finally { setBusy(false); }
  };

  return <section className={`recovery-approval action-card action-${decision}`}>
    <div className="action-card-head"><strong>Win-back campaign</strong><span>{decision}</span></div>
    <p><strong>{proposal.customerCount}</strong> eligible customer{proposal.customerCount === 1 ? "" : "s"} · {formatMoney(proposal.lifetimeValue, proposal.currency)} past spend · two emails each</p>
    <ul>{proposal.touches.map((touch, index) => <li key={index}>Touch {index + 1} · {touch.delayLabel} — {touch.subject}</li>)}</ul>
    {error && <p className="overlay-error">{error}</p>}
    {customers.map((customer) => {
      const open = expanded === customer.id;
      return <div className="recovery-approval-customer" key={customer.id}>
        <button type="button" className="recovery-cart-head" onClick={() => setExpanded(open ? null : customer.id)}><span><strong>{customer.firstName || "Customer"}</strong><small>{customer.lastItems.map((item) => item.title).join(", ")}</small></span><span>{formatMoney(customer.totalSpent, proposal.currency)} lifetime · {open ? "hide" : "preview"}</span></button>
        {open && <div className="recovery-approval-preview">{proposal.touches.map((touch, index) => { const rendered = renderWinback(touch, customer, proposal.storeName, window.location.origin); return <div key={index}><strong>{rendered.subject}</strong><p>{rendered.body}</p></div>; })}</div>}
      </div>;
    })}
    {decision === "proposed" && <p className="action-warning">Review the audience and copy. Nothing sends until you approve.</p>}
    {decision === "approved" && <p className="recovery-approved-note">Scheduled {result?.scheduled ?? 0} emails. {result?.sentNow ?? 0} first-touch email(s) accepted now.{result?.testMode ? " Test mode redirected delivery to the configured inbox." : ""}</p>}
    {decision === "paused" && <p>Paused. No queued emails will send until you resume.</p>}
    {decision === "rejected" && <p>Rejected. This campaign will not be sent.</p>}
    <div className="action-card-buttons">
      {decision === "proposed" && <><button type="button" className="primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Scheduling…" : "Approve and schedule"}</button><button type="button" className="link" disabled={busy} onClick={() => void decide("reject")}>Reject</button></>}
      {decision === "approved" && <button type="button" className="link" disabled={busy} onClick={() => void decide("pause")}>Pause future emails</button>}
      {decision === "paused" && <button type="button" className="primary" disabled={busy} onClick={() => void decide("resume")}>Resume campaign</button>}
    </div>
  </section>;
}
