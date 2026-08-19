import { useEffect, useState } from "react";
import { broadcastCampaignAction, type BroadcastCampaign } from "../lib/broadcastCampaigns";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";

type Decision = "proposed" | "scheduled" | "rejected";
const LABELS: Record<BroadcastCampaign["segment"], string> = {
  subscribers: "All subscribers", recent: "Recent buyers", repeat: "Repeat buyers", vip: "VIP customers", lapsed: "Lapsed subscribers",
};

export function BroadcastApprovalCard({ proposal }: { proposal: BroadcastCampaign }) {
  const [decision, setDecision] = useState<Decision>(proposal.status === "scheduled" ? "scheduled" : proposal.status === "rejected" ? "rejected" : "proposed");
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scheduled?: number; sentNow?: number; testMode?: boolean } | null>(null);

  useEffect(() => { void getEmailDeliverySettings().then(setDelivery).catch(() => setDelivery(null)); }, [proposal.id]);
  const decide = async (action: "approve" | "reject") => {
    if (busy) return;
    if (action === "approve" && delivery?.status !== "ready") { setError("Complete Email setup and send a successful test before scheduling."); return; }
    if (!window.confirm(action === "approve" ? `Approve and schedule this email for ${proposal.customer_count} subscribed customers?` : "Reject this campaign?")) return;
    setBusy(true); setError(null);
    try {
      const next = await broadcastCampaignAction(proposal.id, action);
      setDecision(action === "approve" ? "scheduled" : "rejected"); setResult(next);
      window.dispatchEvent(new CustomEvent("evolution:broadcast-campaign-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Campaign action failed."); }
    finally { setBusy(false); }
  };
  return <section className={`recovery-approval action-card action-${decision}`}>
    <div className="action-card-head"><strong>{proposal.name}</strong><span>{decision}</span></div>
    <p><strong>{proposal.customer_count}</strong> customer{proposal.customer_count === 1 ? "" : "s"} · {LABELS[proposal.segment]} · one email</p>
    <p><strong>Scheduled:</strong> {new Date(proposal.scheduled_at).toLocaleString()}</p>
    <div className="broadcast-email-preview"><span>Subject</span><strong>{proposal.subject}</strong><pre>{proposal.body}</pre></div>
    {error && <p className="overlay-error">{error}</p>}
    {decision === "proposed" && <p className="action-warning">Review the audience, schedule, and copy. Nothing sends until you approve.</p>}
    {decision === "scheduled" && <p className="recovery-approved-note">Scheduled {result?.scheduled ?? proposal.customer_count} email(s). {result?.sentNow ?? 0} sent now.{result?.testMode ? " Test mode redirected delivery." : ""}</p>}
    {decision === "rejected" && <p>Rejected. This campaign will not be sent.</p>}
    <div className="action-card-buttons">{decision === "proposed" && <><button type="button" className="primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Scheduling…" : "Approve and schedule"}</button><button type="button" className="link" disabled={busy} onClick={() => void decide("reject")}>Reject</button></>}</div>
  </section>;
}
