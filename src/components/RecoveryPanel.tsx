/**
 * The Cart Recovery Center — advisory v1.
 *
 * Shows every recoverable abandoned cart (customer, items, value, Shopify
 * recovery link), lets the owner generate + edit a 3-touch email sequence,
 * and renders a personalized ready-to-send email per customer. The OWNER
 * sends from their own mail app (mailto / copy) — Evolution never contacts
 * customers. Personalization is placeholder substitution in code
 * (src/lib/recovery.ts); the model only ever wrote the template.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMoney,
  generateSequence,
  getRecoveryCarts,
  loadSequence,
  mailtoHref,
  renderTouch,
  RecoveryError,
  saveSequence,
  type RecoveryCart,
  type RecoveryData,
  type RecoveryTouch,
} from "../lib/recovery";

const SAVE_DEBOUNCE_MS = 900;

function ageLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function RecoveryPanel({
  open,
  onClose,
  storeName,
}: {
  open: boolean;
  onClose: () => void;
  storeName: string;
}) {
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [touches, setTouches] = useState<RecoveryTouch[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // First open: fetch carts + the saved sequence.
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    void (async () => {
      const [cartsResult, saved] = await Promise.allSettled([getRecoveryCarts(), loadSequence()]);
      if (cartsResult.status === "fulfilled") {
        setData(cartsResult.value);
        setLoadError(null);
      } else {
        const err = cartsResult.reason as unknown;
        setLoadError(
          err instanceof RecoveryError && err.status === 409
            ? "Connect your Shopify store first (My store panel) — recovery works on your real checkouts."
            : err instanceof RecoveryError
              ? err.message
              : "Couldn't load your carts. Try again in a moment.",
        );
      }
      if (saved.status === "fulfilled" && saved.value) setTouches(saved.value);
      setLoading(false);
    })();
  }, [open]);

  const persist = useCallback((next: RecoveryTouch[]) => {
    setTouches(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveSequence(next);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const draft = async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const fresh = await generateSequence();
      persist(fresh);
    } catch {
      setLoadError("Couldn't draft the sequence — try again in a moment.");
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

  const editTouch = (i: number, patch: Partial<RecoveryTouch>) => {
    if (!touches) return;
    persist(touches.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const totalValue = data ? data.carts.reduce((n, c) => n + c.totalPrice, 0) : 0;

  return (
    <aside
      className={`tools-panel recovery-panel card ${open ? "open" : ""}`}
      aria-hidden={!open}
      aria-label="Cart recovery"
    >
      <header className="tools-header">
        <h2>Cart recovery</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      <p className="store-disclaimer">
        <strong>You stay in control.</strong> Evolution prepares every email; you send them from
        your own inbox. We never contact your customers.
      </p>

      {loading && <p className="recovery-muted">Loading your abandoned carts…</p>}
      {loadError && !loading && <p className="overlay-error">{loadError}</p>}

      {data && !loading && (
        <>
          <p className="recovery-stats">
            <strong>{data.carts.length}</strong> recoverable cart{data.carts.length === 1 ? "" : "s"} worth{" "}
            <strong>{formatMoney(totalValue, data.currency)}</strong> in the last {data.windowDays} days
            {data.noEmailCount > 0 && (
              <span className="recovery-muted"> · {data.noEmailCount} more left no email</span>
            )}
          </p>

          <section className="recovery-sequence">
            <div className="recovery-sequence-head">
              <h3>Your 3-touch sequence</h3>
              <button type="button" className="link" onClick={() => void draft()} disabled={drafting}>
                {drafting ? "Writing…" : touches ? "Regenerate" : "Generate my sequence"}
              </button>
            </div>
            {!touches && !drafting && (
              <p className="recovery-muted">
                Generate a sequence tuned to your store, then tweak the copy. Placeholders like{" "}
                <code>{"{{first_name}}"}</code> and <code>{"{{checkout_url}}"}</code> personalize each
                email automatically.
              </p>
            )}
            {touches?.map((t, i) => (
              <div key={i} className="recovery-touch">
                <span className="recovery-touch-when">
                  Touch {i + 1} · {t.delayLabel}
                </span>
                <input
                  type="text"
                  value={t.subject}
                  aria-label={`Touch ${i + 1} subject`}
                  onChange={(e) => editTouch(i, { subject: e.target.value })}
                />
                <textarea
                  rows={5}
                  value={t.body}
                  aria-label={`Touch ${i + 1} body`}
                  onChange={(e) => editTouch(i, { body: e.target.value })}
                />
              </div>
            ))}
          </section>

          <section className="recovery-carts">
            <h3>Recoverable carts</h3>
            {data.carts.length === 0 && (
              <p className="recovery-muted">
                Nothing abandoned with an email in the last {data.windowDays} days — good sign.
              </p>
            )}
            {data.carts.map((cart) => (
              <RecoveryCartCard
                key={cart.id}
                cart={cart}
                currency={data.currency}
                storeName={storeName}
                touches={touches}
                expanded={expanded === cart.id}
                onToggle={() => setExpanded((cur) => (cur === cart.id ? null : cart.id))}
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

function RecoveryCartCard({
  cart,
  currency,
  storeName,
  touches,
  expanded,
  onToggle,
  copiedKey,
  onCopy,
}: {
  cart: RecoveryCart;
  currency: string | null;
  storeName: string;
  touches: RecoveryTouch[] | null;
  expanded: boolean;
  onToggle: () => void;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const itemsLabel = cart.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title)).join(", ");
  return (
    <div className="recovery-cart">
      <button type="button" className="recovery-cart-head" onClick={onToggle}>
        <span className="recovery-cart-who">
          <strong>{cart.firstName || "Shopper"}</strong> <span className="recovery-muted">{cart.email}</span>
        </span>
        <span className="recovery-cart-meta">
          {formatMoney(cart.totalPrice, currency)} · {ageLabel(cart.createdAt)}
        </span>
      </button>
      <p className="recovery-cart-items">{itemsLabel || "(no items listed)"}</p>

      {expanded && (
        <div className="recovery-cart-detail">
          <p className="recovery-cart-link">
            Recovery link:{" "}
            <button
              type="button"
              className="link"
              onClick={() => onCopy(`${cart.id}:url`, cart.recoveryUrl)}
            >
              {copiedKey === `${cart.id}:url` ? "Copied!" : "Copy link"}
            </button>
          </p>
          {!touches && (
            <p className="recovery-muted">Generate your sequence above to see this shopper's emails.</p>
          )}
          {touches?.map((t, i) => {
            const rendered = renderTouch(t, cart, storeName, currency);
            const keyBase = `${cart.id}:${i}`;
            return (
              <div key={i} className="recovery-email">
                <div className="recovery-email-head">
                  <span className="recovery-touch-when">
                    Touch {i + 1} · {t.delayLabel}
                  </span>
                  <span className="recovery-email-actions">
                    <a className="link" href={mailtoHref(cart.email, rendered.subject, rendered.body)}>
                      Open in your email app
                    </a>
                    {" · "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onCopy(`${keyBase}:s`, rendered.subject)}
                    >
                      {copiedKey === `${keyBase}:s` ? "Copied!" : "Copy subject"}
                    </button>
                    {" · "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onCopy(`${keyBase}:b`, rendered.body)}
                    >
                      {copiedKey === `${keyBase}:b` ? "Copied!" : "Copy body"}
                    </button>
                  </span>
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
