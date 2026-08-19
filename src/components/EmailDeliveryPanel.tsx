import { useEffect, useState } from "react";
import { checkEmailDeliveryDomain, getEmailDeliverySettings, saveEmailDeliverySettings, sendEmailDeliveryTest, type DeliveryMode, type EmailDeliverySettings, type EmailRole } from "../lib/emailDelivery";

const choices: { mode: DeliveryMode; title: string; badge: string; copy: string }[] = [
  { mode: "merchant_domain", title: "Send from my brand", badge: "Recommended", copy: "Evolution manages delivery, while customers see your store name and your own verified sending subdomain." },
  { mode: "merchant_resend", title: "Connect my Resend account", badge: "Merchant-owned", copy: "Use your own Resend account, billing and reputation. The API key is encrypted and never returned to the browser." },
  { mode: "evolution_shared", title: "Use Evolution’s domain", badge: "Fallback only", copy: "Fastest for testing, but customers may not recognize the sender. This can reduce trust and conversion." },
];

export function EmailDeliveryPanel({ open, onClose, role }: { open: boolean; onClose: () => void; role: EmailRole }) {
  const [settings, setSettings] = useState<EmailDeliverySettings | null>(null);
  const [mode, setMode] = useState<DeliveryMode>("merchant_domain");
  const [senderName, setSenderName] = useState("");
  const [domain, setDomain] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void getEmailDeliverySettings(role).then((value) => {
      if (!value) return;
      setSettings(value); setMode(value.mode); setSenderName(value.senderName); setDomain(value.sendingDomain ?? "");
      setSenderEmail(value.senderEmail); setReplyTo(value.replyTo); setAck(value.fallbackWarningAcknowledged);
    }).catch((e) => setError(e instanceof Error ? e.message : "Could not load delivery settings."));
  }, [open, role]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const next = await saveEmailDeliverySettings(role, { mode, senderName, sendingDomain: domain, senderEmail, replyTo, providerApiKey: apiKey, fallbackWarningAcknowledged: ack });
      setSettings(next); setApiKey(""); window.dispatchEvent(new CustomEvent("evolution:delivery-settings", { detail: next }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save delivery settings."); }
    finally { setBusy(false); }
  };
  const transition = async (action: "check" | "test") => {
    setBusy(true); setError(null);
    try { const next = action === "check" ? await checkEmailDeliveryDomain(role) : await sendEmailDeliveryTest(role); setSettings(next); window.dispatchEvent(new CustomEvent("evolution:delivery-settings", { detail: next })); }
    catch (e) { setError(e instanceof Error ? e.message : "Delivery check failed."); }
    finally { setBusy(false); }
  };

  return <aside className={`tools-panel delivery-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Email delivery settings">
    <header className="tools-header"><div><h2>Email delivery</h2><p>Choose what customers see in their inbox.</p></div><button type="button" className="link" onClick={onClose}>close</button></header>
    <div className={`delivery-readiness ${settings?.status === "ready" ? "ready" : ""}`}>
      <strong>{settings?.status === "ready" ? "Ready to send" : settings?.status === "pending" ? "DNS verification required" : settings?.status === "test_required" ? "Test email required" : "Delivery is off"}</strong>
      <span>No campaign sends until identity setup, testing and campaign approval are complete.</span>
    </div>
    <div className="delivery-options">{choices.map((choice) => <button type="button" key={choice.mode} className={mode === choice.mode ? "selected" : ""} onClick={() => setMode(choice.mode)}>
      <span><strong>{choice.title}</strong><em>{choice.badge}</em></span><small>{choice.copy}</small>
    </button>)}</div>
    {mode === "evolution_shared" && <div className="delivery-warning"><strong>Not recommended for live customers</strong><p>An email about another store arriving from runevolution.io can look like phishing. Use this only as a temporary fallback or for internal testing.</p><div className="delivery-fixed-sender"><span>Emails will be sent from</span><strong>Evolution &lt;info@runevolution.io&gt;</strong></div><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the sender may reduce customer trust.</label></div>}
    <div className="delivery-form">
      <label>Customer-facing store name<input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Allbirds" /></label>
      {mode !== "evolution_shared" && <label>Sending subdomain<input value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase())} placeholder="email.yourstore.com" /></label>}
      {mode !== "evolution_shared" && <label>From address<input value={senderEmail} onChange={(e) => setSenderEmail(e.target.value.toLowerCase())} placeholder="hello@email.yourstore.com" /></label>}
      <label>Reply-to address <small>Optional — where customer replies should go</small><input value={replyTo} onChange={(e) => setReplyTo(e.target.value.toLowerCase())} placeholder={mode === "evolution_shared" ? "support@yourstore.com" : senderEmail || "support@yourstore.com"} /></label>
      {mode === "merchant_resend" && <label>Resend API key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings?.providerAccountConnected ? "Connected — enter only to replace" : "re_…"} autoComplete="new-password" /></label>}
    </div>
    {settings?.dnsRecords.length ? <section className="delivery-dns"><h3>Add these DNS records</h3><p>Copy them into the DNS provider for your store domain, then return here to verify.</p>{settings.dnsRecords.map((record, i) => <div key={i}><strong>{record.type} · {record.name}</strong><code>{record.value}</code></div>)}</section> : null}
    {error && <p className="overlay-error">{error}</p>}
    <div className="delivery-actions"><button type="button" className="primary" disabled={busy || (mode === "evolution_shared" && !ack)} onClick={() => void save()}>{busy ? "Working…" : settings ? "Save delivery setup" : "Start setup"}</button>{settings?.status === "pending" && <button type="button" disabled={busy} onClick={() => void transition("check")}>Check DNS</button>}{settings?.status === "test_required" && <button type="button" disabled={busy} onClick={() => void transition("test")}>Send test email</button>}</div>
    <p className="manager-safety"><strong>Shopify connection:</strong> supplies customers, carts and checkout links. Your verified email provider supplies the sender identity and delivery.</p>
  </aside>;
}
