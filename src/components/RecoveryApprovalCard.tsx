import { useEffect, useState } from "react";
import {
  formatMoney,
  getRecoveryCarts,
  renderTouch,
  type RecoveryCampaignProposal,
  type RecoveryCart,
} from "../lib/recovery";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";
import { recoveryCampaignAction } from "../lib/recoveryCampaigns";

type Decision = "proposed" | "approved" | "paused" | "rejected";

export function RecoveryApprovalCard({ proposal }: { proposal: RecoveryCampaignProposal }) {
  const [carts, setCarts] = useState<RecoveryCart[]>([]);
  const [decision, setDecision] = useState<Decision>("proposed");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ scheduled?: number; sentNow?: number; skipped?: number; failed?: number; testMode?: boolean } | null>(null);

  useEffect(() => {
    void getRecoveryCarts()
      .then((data) => setCarts(data.carts))
      .catch(() => setError("Customer previews could not be refreshed."));
    void getEmailDeliverySettings().then(setDelivery).catch(() => setDelivery(null));
  }, [proposal.id]);

  const decide = async (action: "approve" | "reject" | "pause" | "resume") => {
    if (busy) return;
    if (action === "approve" && delivery?.status !== "ready") { setError("Complete Email setup and send a successful test before scheduling."); return; }
    const prompt = action === "approve" ? `Approve and schedule this campaign for ${proposal.cartCount} recoverable cart${proposal.cartCount === 1 ? "" : "s"}? The first email is due now.` : action === "reject" ? "Reject this campaign? It will not be scheduled." : action === "pause" ? "Pause all future emails in this campaign?" : "Resume this campaign and its remaining scheduled emails?";
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(null);
    try { const next = await recoveryCampaignAction(proposal.id, action); setDecision(action === "approve" || action === "resume" ? "approved" : action === "pause" ? "paused" : "rejected"); setResult(next); window.dispatchEvent(new CustomEvent("evolution:recovery-campaign-changed")); }
    catch (e) { setError(e instanceof Error ? e.message : "Campaign action failed."); }
    finally { setBusy(false); }
  };

  return (
    <section className={`recovery-approval action-card action-${decision}`}>
      <div className="action-card-head"><strong>Abandoned-cart campaign</strong><span>{decision}</span></div>
      <p><strong>{proposal.cartCount}</strong> customer{proposal.cartCount === 1 ? "" : "s"} · {formatMoney(proposal.totalValue, proposal.currency)} recoverable value · 3 personalized emails each</p>
      <ul>{proposal.touches.map((touch, i) => <li key={i}>Touch {i + 1} · {touch.delayLabel} — {touch.subject}</li>)}</ul>
      {error && <p className="overlay-error">{error}</p>}
      {carts.map((cart) => {
        const open = expanded === cart.id;
        const items = cart.items.map((item) => item.qty > 1 ? `${item.qty}× ${item.title}` : item.title).join(", ");
        return <div className="recovery-approval-customer" key={cart.id}>
          <button type="button" className="recovery-cart-head" onClick={() => setExpanded(open ? null : cart.id)}>
            <span><strong>{cart.firstName || "Shopper"}</strong><small>{items}</small></span>
            <span>{formatMoney(cart.totalPrice, proposal.currency)} · {open ? "hide" : "preview"}</span>
          </button>
          {open && <div className="recovery-approval-preview">{proposal.touches.map((touch, i) => {
            const rendered = renderTouch(touch, cart, proposal.storeName, proposal.currency);
            return <div key={i}><strong>{rendered.subject}</strong><p>{rendered.body}</p></div>;
          })}</div>}
        </div>;
      })}
      {decision === "proposed" && <p className="action-warning">Review the recipients and copy. Nothing sends until you approve.</p>}
      {decision === "approved" && <p className="recovery-approved-note">Scheduled {result?.scheduled ?? 0} emails. {result?.sentNow ?? 0} first-touch email{result?.sentNow === 1 ? " was" : "s were"} accepted by Resend now; later touches will run automatically.{result?.testMode ? " Test mode redirected delivery to the configured test inbox." : ""}</p>}
      {decision === "rejected" && <p>Rejected. This campaign will not be sent.</p>}
      {decision === "paused" && <p>Paused. No queued emails will send until you resume.</p>}
      <div className="action-card-buttons">
        {decision === "proposed" && <><button type="button" className="primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Scheduling…" : "Approve and schedule"}</button><button type="button" className="link" disabled={busy} onClick={() => void decide("reject")}>Reject</button></>}
        {decision === "approved" && <button type="button" className="link" disabled={busy} onClick={() => void decide("pause")}>Pause future emails</button>}
        {decision === "paused" && <button type="button" className="primary" disabled={busy} onClick={() => void decide("resume")}>Resume campaign</button>}
      </div>
    </section>
  );
}
