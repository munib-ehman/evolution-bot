/**
 * The Retention Center — advisory v1.
 *
 * Two jobs in one panel: win back lapsed customers (no order in 60–365 days)
 * and ask recent buyers (7–30 days) for a review. The owner generates + edits
 * the email templates once, then every customer card renders personalized
 * ready-to-send emails. The OWNER sends from their own mail app (mailto /
 * copy) — Evolution never contacts customers. Personalization is placeholder
 * substitution in code (src/lib/retention.ts); the model only ever wrote the
 * template.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMoney,
  generateTemplates,
  getRetentionCustomers,
  loadTemplates,
  mailtoHref,
  renderReview,
  renderWinback,
  RetentionError,
  saveTemplates,
  type LapsedCustomer,
  type RecentBuyer,
  type RetentionData,
  type RetentionTemplates,
  type RetentionTouch,
} from "../lib/retention";

const SAVE_DEBOUNCE_MS = 900;

function ageLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `${days} day${days > 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

const EMPTY_TEMPLATES: RetentionTemplates = { winback: [], review: [], reviewLink: "" };

export function RetentionPanel({
  open,
  onClose,
  storeName,
  storeUrl,
}: {
  open: boolean;
  onClose: () => void;
  storeName: string;
  storeUrl: string;
}) {
  const [data, setData] = useState<RetentionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<RetentionTemplates | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // First open: fetch customers + the saved templates.
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    void (async () => {
      const [customersResult, saved] = await Promise.allSettled([
        getRetentionCustomers(),
        loadTemplates(),
      ]);
      if (customersResult.status === "fulfilled") {
        setData(customersResult.value);
        setLoadError(null);
      } else {
        const err = customersResult.reason as unknown;
        setLoadError(
          err instanceof RetentionError && err.status === 409
            ? "Connect your Shopify store first (My store panel) — retention works on your real customers."
            : err instanceof RetentionError
              ? err.message
              : "Couldn't load your customers. Try again in a moment.",
        );
      }
      if (saved.status === "fulfilled" && saved.value) setTemplates(saved.value);
      setLoading(false);
    })();
  }, [open]);

  const persist = useCallback((next: RetentionTemplates) => {
    setTemplates(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveTemplates(next);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const draft = async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const fresh = await generateTemplates();
      persist({ ...fresh, reviewLink: templates?.reviewLink ?? "" });
    } catch {
      setLoadError("Couldn't draft the emails — try again in a moment.");
    } finally {
      setDrafting(false);
    }
  };

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  };

  const editTouch = (kind: "winback" | "review", i: number, patch: Partial<RetentionTouch>) => {
    if (!templates) return;
    persist({
      ...templates,
      [kind]: templates[kind].map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    });
  };

  const hasTemplates = !!templates && templates.winback.length === 2 && templates.review.length === 1;
  const lapsedValue = data ? data.lapsed.reduce((n, c) => n + c.totalSpent, 0) : 0;

  return (
    <aside
      className={`tools-panel recovery-panel retention-panel card ${open ? "open" : ""}`}
      aria-hidden={!open}
      aria-label="Reviews and retention"
    >
      <header className="tools-header">
        <h2>Reviews &amp; retention</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      <p className="store-disclaimer">
        <strong>You stay in control.</strong> Evolution prepares every email; you send them from
        your own inbox. We never contact your customers.
      </p>

      {loading && <p className="recovery-muted">Looking through your customers…</p>}
      {loadError && !loading && <p className="overlay-error">{loadError}</p>}

      {data && !loading && (
        <>
          <p className="recovery-stats">
            <strong>{data.lapsed.length}</strong> lapsed customer{data.lapsed.length === 1 ? "" : "s"} worth{" "}
            <strong>{formatMoney(lapsedValue, data.currency)}</strong> lifetime ·{" "}
            <strong>{data.buyers.length}</strong> fulfilled buyer{data.buyers.length === 1 ? "" : "s"} to ask
            for reviews
            {data.noEmailCounts.lapsed + data.noEmailCounts.buyers > 0 && (
              <span className="recovery-muted">
                {" "}
                · {data.noEmailCounts.lapsed + data.noEmailCounts.buyers} more left no email
              </span>
            )}
          </p>
          {data.lapsedUnavailable && (
            <p className="recovery-muted">Couldn't read your customer list right now — buyers still loaded.</p>
          )}
          {data.buyersUnavailable && (
            <p className="recovery-muted">Couldn't read recent orders right now — lapsed customers still loaded.</p>
          )}

          <section className="recovery-sequence">
            <div className="recovery-sequence-head">
              <h3>Your retention emails</h3>
              <button type="button" className="link" onClick={() => void draft()} disabled={drafting}>
                {drafting ? "Writing…" : hasTemplates ? "Regenerate" : "Generate my emails"}
              </button>
            </div>
            {!hasTemplates && !drafting && (
              <p className="recovery-muted">
                Generate two win-back emails and a review request tuned to your store, then tweak the
                copy. Placeholders like <code>{"{{first_name}}"}</code> and <code>{"{{items}}"}</code>{" "}
                personalize each email automatically.
              </p>
            )}
            {hasTemplates &&
              templates.winback.map((t, i) => (
                <div key={`w${i}`} className="recovery-touch">
                  <span className="recovery-touch-when">
                    Win-back {i + 1} · {t.delayLabel}
                  </span>
                  <input
                    type="text"
                    value={t.subject}
                    aria-label={`Win-back ${i + 1} subject`}
                    onChange={(e) => editTouch("winback", i, { subject: e.target.value })}
                  />
                  <textarea
                    rows={5}
                    value={t.body}
                    aria-label={`Win-back ${i + 1} body`}
                    onChange={(e) => editTouch("winback", i, { body: e.target.value })}
                  />
                </div>
              ))}
            {hasTemplates && (
              <>
                <div className="recovery-touch">
                  <span className="recovery-touch-when">
                    Review request · {templates.review[0].delayLabel}
                  </span>
                  <input
                    type="text"
                    value={templates.review[0].subject}
                    aria-label="Review request subject"
                    onChange={(e) => editTouch("review", 0, { subject: e.target.value })}
                  />
                  <textarea
                    rows={5}
                    value={templates.review[0].body}
                    aria-label="Review request body"
                    onChange={(e) => editTouch("review", 0, { body: e.target.value })}
                  />
                </div>
                <label className="retention-review-link">
                  <span className="recovery-muted">
                    Your review page link (Judge.me, Google, a product page… blank = your store link)
                  </span>
                  <input
                    type="url"
                    value={templates.reviewLink}
                    placeholder={storeUrl}
                    onChange={(e) => persist({ ...templates, reviewLink: e.target.value })}
                  />
                </label>
              </>
            )}
          </section>

          <section className="recovery-carts">
            <h3>Win back lapsed customers</h3>
            {data.lapsed.length === 0 && (
              <p className="recovery-muted">
                Nobody's gone quiet — every customer with an email ordered within the last{" "}
                {data.lapsedWindow.minDays} days (or your store is younger than that).
              </p>
            )}
            {data.lapsed.map((customer) => (
              <LapsedCard
                key={customer.id}
                customer={customer}
                currency={data.currency}
                storeName={storeName}
                storeUrl={storeUrl}
                touches={hasTemplates ? templates.winback : null}
                expanded={expanded === `lapsed:${customer.id}`}
                onToggle={() =>
                  setExpanded((cur) => (cur === `lapsed:${customer.id}` ? null : `lapsed:${customer.id}`))
                }
                copiedKey={copied}
                onCopy={copy}
              />
            ))}
          </section>

          <section className="recovery-carts">
            <h3>Ask for reviews</h3>
            {data.buyers.length === 0 && (
              <p className="recovery-muted">
                No successfully fulfilled orders {data.buyerWindow.minDays}–{data.buyerWindow.maxDays} days past fulfillment with an email.
              </p>
            )}
            {data.buyers.map((buyer) => (
              <BuyerCard
                key={buyer.orderId}
                buyer={buyer}
                currency={data.currency}
                storeName={storeName}
                storeUrl={storeUrl}
                reviewLink={templates?.reviewLink ?? ""}
                touch={hasTemplates ? templates.review[0] : null}
                expanded={expanded === `buyer:${buyer.orderId}`}
                onToggle={() =>
                  setExpanded((cur) => (cur === `buyer:${buyer.orderId}` ? null : `buyer:${buyer.orderId}`))
                }
                copiedKey={copied}
                onCopy={copy}
              />
            ))}
          </section>
        </>
      )}
    </aside>
  );
}

function EmailActions({
  email,
  rendered,
  keyBase,
  copiedKey,
  onCopy,
}: {
  email: string;
  rendered: { subject: string; body: string };
  keyBase: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <span className="recovery-email-actions">
      <a className="link" href={mailtoHref(email, rendered.subject, rendered.body)}>
        Open in your email app
      </a>
      {" · "}
      <button type="button" className="link" onClick={() => onCopy(`${keyBase}:s`, rendered.subject)}>
        {copiedKey === `${keyBase}:s` ? "Copied!" : "Copy subject"}
      </button>
      {" · "}
      <button type="button" className="link" onClick={() => onCopy(`${keyBase}:b`, rendered.body)}>
        {copiedKey === `${keyBase}:b` ? "Copied!" : "Copy body"}
      </button>
    </span>
  );
}

function LapsedCard({
  customer,
  currency,
  storeName,
  storeUrl,
  touches,
  expanded,
  onToggle,
  copiedKey,
  onCopy,
}: {
  customer: LapsedCustomer;
  currency: string | null;
  storeName: string;
  storeUrl: string;
  touches: RetentionTouch[] | null;
  expanded: boolean;
  onToggle: () => void;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const itemsLine = customer.lastItems
    .map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title))
    .join(", ");
  return (
    <div className="recovery-cart">
      <button type="button" className="recovery-cart-head" onClick={onToggle}>
        <span className="recovery-cart-who">
          <strong>{customer.firstName || "Customer"}</strong>{" "}
          <span className="recovery-muted">{customer.email}</span>
        </span>
        <span className="recovery-cart-meta">
          {formatMoney(customer.totalSpent, currency)} lifetime · last order {ageLabel(customer.lastOrderAt)}
        </span>
      </button>
      <p className="recovery-cart-items">{itemsLine || "(no items listed)"}</p>

      {expanded && (
        <div className="recovery-cart-detail">
          {!touches && (
            <p className="recovery-muted">Generate your emails above to see this customer's notes.</p>
          )}
          {touches?.map((t, i) => {
            const rendered = renderWinback(t, customer, storeName, storeUrl);
            const keyBase = `${customer.id}:w${i}`;
            return (
              <div key={i} className="recovery-email">
                <div className="recovery-email-head">
                  <span className="recovery-touch-when">
                    Win-back {i + 1} · {t.delayLabel}
                  </span>
                  <EmailActions
                    email={customer.email}
                    rendered={rendered}
                    keyBase={keyBase}
                    copiedKey={copiedKey}
                    onCopy={onCopy}
                  />
                </div>
                <p className="recovery-email-subject">{rendered.subject}</p>
                <pre className="recovery-email-body">{rendered.body}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BuyerCard({
  buyer,
  currency,
  storeName,
  storeUrl,
  reviewLink,
  touch,
  expanded,
  onToggle,
  copiedKey,
  onCopy,
}: {
  buyer: RecentBuyer;
  currency: string | null;
  storeName: string;
  storeUrl: string;
  reviewLink: string;
  touch: RetentionTouch | null;
  expanded: boolean;
  onToggle: () => void;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const itemsLine = buyer.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title)).join(", ");
  return (
    <div className="recovery-cart">
      <button type="button" className="recovery-cart-head" onClick={onToggle}>
        <span className="recovery-cart-who">
          <strong>{buyer.firstName || "Customer"}</strong>{" "}
          <span className="recovery-muted">{buyer.email}</span>
        </span>
        <span className="recovery-cart-meta">
          {formatMoney(buyer.totalPrice, currency)} · fulfilled {ageLabel(buyer.fulfilledAt)}
        </span>
      </button>
      <p className="recovery-cart-items">{itemsLine || "(no items listed)"}</p>

      {expanded && (
        <div className="recovery-cart-detail">
          {!touch && (
            <p className="recovery-muted">Generate your emails above to see this buyer's review request.</p>
          )}
          {touch &&
            (() => {
              const rendered = renderReview(touch, buyer, storeName, storeUrl, reviewLink);
              const keyBase = `${buyer.orderId}:r`;
              return (
                <div className="recovery-email">
                  <div className="recovery-email-head">
                    <span className="recovery-touch-when">Review request · {touch.delayLabel}</span>
                    <EmailActions
                      email={buyer.email}
                      rendered={rendered}
                      keyBase={keyBase}
                      copiedKey={copiedKey}
                      onCopy={onCopy}
                    />
                  </div>
                  <p className="recovery-email-subject">{rendered.subject}</p>
                  <pre className="recovery-email-body">{rendered.body}</pre>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
