import { useEffect, useState } from "react";
import { getEmailDeliverySettings, type EmailDeliverySettings } from "../lib/emailDelivery";
import { formatMoney } from "../lib/recovery";
import { draftSupportEmail, getSupportCases, resolveSupportCase, sendSupportEmail, type SupportCase, type SupportResolution, type SupportOwner } from "../lib/supportCases";

const RESOLUTIONS: { value: SupportResolution; label: string }[] = [
  { value: "investigating", label: "Still investigating" },
  { value: "ship_date", label: "Confirmed ship date" },
  { value: "cancel_refund", label: "Offer cancellation or refund" },
  { value: "custom", label: "Custom verified resolution" },
];
const age = (iso: string) => `${Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3_600_000))} hours`;

export function SupportPanel({ open, onClose, onOpenDelivery, focusOrderId, role, section="risks" }: { open: boolean; onClose: () => void; onOpenDelivery: () => void; focusOrderId?: string | null; role: SupportOwner; section?: "risks"|"responses"|"resolution" }) {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [delivery, setDelivery] = useState<EmailDeliverySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [resolution, setResolution] = useState<SupportResolution>("investigating");
  const [detail, setDetail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [rows, settings] = await Promise.all([getSupportCases(role), getEmailDeliverySettings(role)]);
      setCases(rows); setDelivery(settings);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load support risks."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open) void refresh(); }, [open, role]);
  useEffect(()=>{if(!open||!focusOrderId||!cases.length)return;const supportCase=cases.find(item=>item.id===focusOrderId);if(!supportCase)return;setActive(supportCase.id);setResolution(supportCase.notification?.resolution??"investigating");setDetail("");setSubject(supportCase.notification?.subject??"");setMessage(supportCase.notification?.body??"");setApproved(false);},[open,focusOrderId,cases]);

  const select = (supportCase: SupportCase) => {
    setActive(supportCase.id); setResolution(supportCase.notification?.resolution ?? "investigating"); setDetail("");
    setSubject(supportCase.notification?.subject ?? ""); setMessage(supportCase.notification?.body ?? ""); setApproved(false); setError(null);
  };
  useEffect(()=>{if(!open||section!=="responses"||focusOrderId||active||!cases.length)return;const prepared=cases.find(item=>item.notification?.status==="proposed"||item.notification?.status==="failed");if(prepared)select(prepared);},[open,section,focusOrderId,active,cases]);
  const updateNotification = (orderId: string, notification: SupportCase["notification"]) => setCases((rows) => rows.map((row) => row.id === orderId ? { ...row, notification } : row));
  const generate = async (supportCase: SupportCase) => {
    setBusy(true); setError(null);
    try { const notification = await draftSupportEmail(role, supportCase.id, resolution, detail); updateNotification(supportCase.id, notification); setSubject(notification.subject); setMessage(notification.body); setApproved(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not generate the support email."); }
    finally { setBusy(false); }
  };
  const send = async (supportCase: SupportCase) => {
    if (!approved) return;
    setBusy(true); setError(null);
    try { const result = await sendSupportEmail(role, supportCase.id, subject, message); updateNotification(supportCase.id, result.notification ?? null); setApproved(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send the support email."); }
    finally { setBusy(false); }
  };
  const resolve = async (supportCase: SupportCase) => {
    setBusy(true); setError(null);
    try { updateNotification(supportCase.id, await resolveSupportCase(role, supportCase.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve this support case."); }
    finally { setBusy(false); }
  };

  const titles={risks:["Risk detection","Live fulfillment risks found from Shopify order evidence."],responses:["Response preparation","Fact-based customer updates prepared automatically for approval."],resolution:["Resolution tracking","Track notifications and close customer-impacting issues."]} as const;
  const shownCases=cases.filter(item=>section==="risks"||section==="responses"?section==="risks"||!item.notification||["proposed","failed"].includes(item.notification.status):["sent","resolved"].includes(item.notification?.status??""));
  return <aside className={`tools-panel recovery-panel support-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Customer support">
    <header className="tools-header"><div><span className="manager-kicker">Customer support</span><h2>{titles[section][0]}</h2><p>{titles[section][1]}</p></div><button type="button" className="link" onClick={onClose}>close</button></header>
    {section==="responses"&&<><p className="store-disclaimer"><strong>Approval required.</strong> Evolution never sends a support email until you review the exact subject and message and approve it.</p><div className={`delivery-readiness ${delivery?.status === "ready" ? "ready" : ""}`}><strong>{delivery?.status === "ready" ? `Ready to send as ${delivery.senderName}` : "Email delivery setup required"}</strong><span>{delivery?.status === "ready" ? `Replies go to ${delivery.replyTo}.` : "Configure and test a verified sender before contacting customers."}</span>{delivery?.status !== "ready" && <button type="button" className="link" onClick={onOpenDelivery}>Open Email setup</button>}</div></>}
    {loading && <p className="recovery-muted">Checking live Shopify orders…</p>}{error && <p className="overlay-error">{error}</p>}
    {!loading && shownCases.length === 0 && !error && <p className="recovery-muted">{section==="resolution"?"No sent or resolved customer cases yet.":section==="responses"?"No customer response currently needs approval.":"No fulfillment risks currently need customer notification."}</p>}
    <section className="support-case-list">{shownCases.map((supportCase) => {
      const openCase = active === supportCase.id; const sent = supportCase.notification?.status === "sent"; const resolved = supportCase.notification?.status === "resolved";
      if(section==="risks")return <article className="support-risk-evidence" key={supportCase.id}><header><div><span className="manager-kicker">Fulfillment risk</span><h3>{supportCase.name}</h3></div><strong>{age(supportCase.createdAt)} waiting</strong></header><div className="support-risk-facts"><div><span>Order value</span><strong>{formatMoney(supportCase.totalPrice,null)}</strong></div><div><span>Fulfillment</span><strong>Still unfulfilled</strong></div><div><span>Customer contact</span><strong>{supportCase.email?"Available":"Missing"}</strong></div></div><section><h4>Why Evolution flagged this</h4><ul><li>The order has remained unfulfilled for more than the 48-hour customer-care threshold.</li><li>A prolonged wait can reduce customer trust if no proactive update is provided.</li><li>{supportCase.email?"The customer can receive a proactive status update.":"No contactable email is available, so outreach is blocked."}</li></ul></section><p><strong>Order contents:</strong> {supportCase.items.map(item=>item.qty>1?`${item.qty}× ${item.title}`:item.title).join(", ")}</p><footer><span>No unsupported cause or ship date is assumed.</span><strong>{supportCase.notification?"Response prepared for approval":"Preparing safe response"}</strong></footer></article>;
      if(section==="resolution")return <article className={`support-resolution-card ${resolved?"resolved":""}`} key={supportCase.id}><header><div><span className="manager-kicker">{resolved?"Closed case":"Customer notified"}</span><h3>{supportCase.name}</h3></div><strong>{resolved?"Resolved":"Awaiting resolution"}</strong></header><p>{sent?`The approved customer update was sent${supportCase.notification?.sent_at?` on ${new Date(supportCase.notification.sent_at).toLocaleString()}`:""}.`:"This case is recorded as resolved."}</p><div className="support-risk-facts"><div><span>Delivery</span><strong>{supportCase.notification?.delivery_status??supportCase.notification?.status}</strong></div><div><span>Duplicate protection</span><strong>Active</strong></div></div>{!resolved&&<button type="button" disabled={busy} onClick={()=>void resolve(supportCase)}>Mark customer issue resolved</button>}</article>;
      return <article className={`support-case ${sent ? "sent" : ""} ${resolved ? "resolved" : ""}`} key={supportCase.id}>
        <button type="button" className="support-case-head" onClick={() => openCase ? setActive(null) : select(supportCase)}><span><strong>{supportCase.name}</strong><small>{supportCase.email || "No customer email"}</small></span><span><strong>{formatMoney(supportCase.totalPrice, null)}</strong><small>Waiting {age(supportCase.createdAt)}</small></span><em>{resolved ? "Resolved" : sent ? "Customer notified" : "Needs attention"}</em></button>
        <p>{supportCase.items.map((item) => item.qty > 1 ? `${item.qty}× ${item.title}` : item.title).join(", ")}</p>
        {openCase && <div className="support-workflow">
          {sent ? <><p className="recovery-approved-note">Email sent {supportCase.notification?.sent_at ? new Date(supportCase.notification.sent_at).toLocaleString() : ""}. Duplicate sending is blocked.</p><button type="button" disabled={busy || resolved} onClick={() => void resolve(supportCase)}>{resolved ? "Resolved" : "Mark resolved"}</button></> : <>
            <label>Verified next action<select value={resolution} onChange={(event) => { setResolution(event.target.value as SupportResolution); setApproved(false); }} disabled={busy}>{RESOLUTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            {(resolution === "ship_date" || resolution === "custom") && <label>{resolution === "ship_date" ? "Confirmed ship date and wording" : "Verified resolution details"}<textarea rows={3} value={detail} onChange={(event) => setDetail(event.target.value)} placeholder={resolution === "ship_date" ? "Example: by Friday, August 21" : "Only include facts you have confirmed"} /></label>}
            <button type="button" disabled={busy || !supportCase.email} title={!supportCase.email?"Add or confirm the customer email on this Shopify order first.":undefined} onClick={() => void generate(supportCase)}>{busy ? "Working…" : !supportCase.email?"Customer email required":supportCase.notification ? "Regenerate email" : "Generate customer email"}</button>
            {supportCase.notification && <div className="support-email-review"><span className="manager-kicker">Exact email for approval</span><label>Subject<input value={subject} onChange={(event) => { setSubject(event.target.value); setApproved(false); }} /></label><label>Message<textarea rows={9} value={message} onChange={(event) => { setMessage(event.target.value); setApproved(false); }} /></label><label className="support-approval"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I reviewed this message and approve sending it to the customer for {supportCase.name}.</label><button type="button" className="primary" disabled={busy || !approved || delivery?.status !== "ready"} onClick={() => void send(supportCase)}>Approve &amp; send email</button></div>}
          </>}
        </div>}
      </article>;
    })}</section>
  </aside>;
}
