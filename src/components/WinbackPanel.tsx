import { useEffect, useMemo, useState } from "react";
import { formatMoney, generateTemplates, getRetentionCustomers, loadTemplates, saveTemplates, type LapsedCustomer, type RetentionData, type RetentionTemplates, type RetentionTouch } from "../lib/retention";

type Segment = "best" | "vip" | "repeat" | "recent" | "all";
type Offer = "none" | "10% off" | "15% off" | "free shipping";
const SEGMENTS: Record<Segment, [string, string]> = {
  best: ["Recommended", "Higher-value repeat customers most worth winning back."],
  vip: ["VIP customers", "Top 25% by lifetime spend."],
  repeat: ["Repeat buyers", "Customers with two or more previous orders."],
  recent: ["Recently lapsed", "Last purchase was 60–120 days ago."],
  all: ["All eligible", "Every contactable customer inactive for 60–365 days."],
};
const daysSince = (value: string) => Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000));
function selectAudience(customers: LapsedCustomer[], segment: Segment) {
  if (segment === "all") return customers;
  if (segment === "repeat") return customers.filter((c) => c.ordersCount >= 2);
  if (segment === "recent") return customers.filter((c) => daysSince(c.lastOrderAt) <= 120);
  const ranked = [...customers].sort((a, b) => b.totalSpent - a.totalSpent);
  if (segment === "vip") return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * .25)));
  const repeat = ranked.filter((c) => c.ordersCount >= 2);
  return (repeat.length ? repeat : ranked).slice(0, Math.max(1, Math.ceil(customers.length * .4)));
}

export function WinbackPanel({ open, onClose, onBuild }: { open: boolean; onClose: () => void; onBuild: (prompt: string) => void }) {
  const [data, setData] = useState<RetentionData | null>(null);
  const [templates, setTemplates] = useState<RetentionTemplates | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("best");
  const [offer, setOffer] = useState<Offer>("none");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadAudience = () => {
    setLoading(true); setError(null);
    void Promise.allSettled([getRetentionCustomers(), loadTemplates()]).then(([audience, saved]) => {
      if (audience.status === "fulfilled") setData(audience.value);
      else setError("I couldn’t load the win-back audience. Check the Shopify connection and retry.");
      if (saved.status === "fulfilled" && saved.value) setTemplates(saved.value);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (!open) return;
    loadAudience();
    // Opening the drawer is the refresh boundary; manual retries use the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const audience = useMemo(() => selectAudience(data?.lapsed ?? [], segment), [data, segment]);
  const spend = audience.reduce((sum, customer) => sum + customer.totalSpent, 0);
  const average = audience.length ? spend / audience.length : 0;
  const generate = async () => {
    setDrafting(true); setError(null);
    try {
      const generated = await generateTemplates(`${SEGMENTS[segment][0]} audience. ${offer === "none" ? "No discount; lead with relevance and loyalty." : `Use a ${offer} incentive.`}`);
      const next = { ...generated, reviewLink: templates?.reviewLink ?? "" };
      setTemplates(next); await saveTemplates(next);
    } catch { setError("I couldn’t generate the campaign copy. Try again."); }
    finally { setDrafting(false); }
  };
  const editTouch = (index: number, patch: Partial<RetentionTouch>) => {
    if (!templates) return;
    const next = { ...templates, winback: templates.winback.map((touch, i) => i === index ? { ...touch, ...patch } : touch) };
    setTemplates(next); void saveTemplates(next);
  };
  const build = () => {
    onBuild(`Create a win-back campaign for the ${SEGMENTS[segment][0].toLowerCase()} segment ${offer === "none" ? "without a discount" : `with ${offer}`}. The selected audience is ${audience.length} customers with ${formatMoney(spend, data?.currency ?? null)} in lifetime spend. Use the saved two-email copy and show the approval card. Nothing should send without approval.`);
    onClose();
  };

  return <aside className={`tools-panel recovery-panel winback-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Win-back campaign">
    <header className="tools-header"><div><span className="manager-kicker">Marketing Manager</span><h2>Win-back campaign</h2></div><button type="button" className="link" onClick={onClose}>close</button></header>
    <p className="winback-intro">Bring valuable past customers back with a focused audience, a sensible offer, and two approval-gated emails.</p>
    {loading && <div className="winback-loading">Analyzing customer purchase history…</div>}
    {error && <div className="winback-error"><p className="overlay-error">{error}</p><button type="button" onClick={loadAudience}>Retry Shopify data</button></div>}
    {data && !loading && <>
      <section className="winback-summary">
        <div><span>Selected audience</span><strong>{audience.length}</strong><small>of {data.lapsed.length} eligible</small></div>
        <div><span>Lifetime spend</span><strong>{formatMoney(spend, data.currency)}</strong><small>{formatMoney(average, data.currency)} average</small></div>
        <div><span>Potential return</span><strong>{formatMoney(average * audience.length * .05, data.currency)}–{formatMoney(average * audience.length * .12, data.currency)}</strong><small>5–12% planning range</small></div>
      </section>
      <section className="winback-section">
        <SectionHead step="Step 1" title="Choose the audience" note="Evolution recommends a focused segment" />
        <div className="winback-segments">{(Object.keys(SEGMENTS) as Segment[]).map((key) => <button type="button" className={segment === key ? "selected" : ""} onClick={() => setSegment(key)} key={key}><strong>{SEGMENTS[key][0]}</strong><span>{SEGMENTS[key][1]}</span></button>)}</div>
      </section>
      <section className="winback-section">
        <SectionHead step="Step 2" title="Choose the reason to return" note="Start without a discount when loyalty is enough" />
        <div className="winback-offers">{(["none", "10% off", "15% off", "free shipping"] as Offer[]).map((value) => <label key={value}><input type="radio" name="offer" checked={offer === value} onChange={() => setOffer(value)} /><span><strong>{value === "none" ? "No discount" : value}</strong><small>{value === "none" ? "Recommended first" : value === "10% off" ? "Light incentive" : value === "15% off" ? "VIP recovery" : "Protects product value"}</small></span></label>)}</div>
      </section>
      <section className="winback-section">
        <div className="winback-section-head"><div><span>Step 3</span><h3>Review the two-email sequence</h3></div><button type="button" className="link" disabled={drafting} onClick={() => void generate()}>{drafting ? "Writing…" : templates?.winback.length === 2 ? "Rewrite for this plan" : "Generate emails"}</button></div>
        {!templates?.winback.length && <p className="recovery-muted">Generate copy tailored to the audience and offer above.</p>}
        {templates?.winback.map((touch, index) => <div className="recovery-touch" key={index}><span className="recovery-touch-when">Email {index + 1} · {index === 0 ? "after approval" : "10 days later if still eligible"}</span><input value={touch.subject} aria-label={`Win-back email ${index + 1} subject`} onChange={(e) => editTouch(index, { subject: e.target.value })} /><textarea rows={4} value={touch.body} aria-label={`Win-back email ${index + 1} body`} onChange={(e) => editTouch(index, { body: e.target.value })} /></div>)}
      </section>
      <section className="winback-section">
        <SectionHead step="Audience preview" title="Who will receive it" note="Rechecked before every send" />
        <div className="winback-audience-list">{audience.slice(0, 12).map((customer) => <CustomerRow customer={customer} currency={data.currency} open={expanded === customer.id} onToggle={() => setExpanded(expanded === customer.id ? null : customer.id)} key={customer.id} />)}</div>
        {audience.length > 12 && <p className="recovery-muted">And {audience.length - 12} more customers in this segment.</p>}
      </section>
      <footer className="winback-footer"><div><strong>{audience.length} customers · two emails</strong><span>Nothing sends until you approve the campaign card.</span></div><button type="button" className="primary" disabled={!audience.length || templates?.winback.length !== 2} onClick={build}>Create approval draft</button></footer>
    </>}
  </aside>;
}

function SectionHead({ step, title, note }: { step: string; title: string; note: string }) { return <div className="winback-section-head"><div><span>{step}</span><h3>{title}</h3></div><small>{note}</small></div>; }
function CustomerRow({ customer, currency, open, onToggle }: { customer: LapsedCustomer; currency: string | null; open: boolean; onToggle: () => void }) {
  return <div className="winback-customer"><button type="button" onClick={onToggle}><span><strong>{customer.firstName || "Customer"}</strong><small>{customer.ordersCount} order{customer.ordersCount === 1 ? "" : "s"} · last purchase {daysSince(customer.lastOrderAt)} days ago</small></span><span><strong>{formatMoney(customer.totalSpent, currency)}</strong><small>lifetime</small></span></button>{open && <div><span>Previously bought</span><p>{customer.lastItems.map((item) => item.title).join(", ") || "Order details unavailable"}</p></div>}</div>;
}
