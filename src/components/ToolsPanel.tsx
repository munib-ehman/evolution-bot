/**
 * The "My store" panel — the store's public address (what the free audit
 * scans, editable here), the founder's Shopify OAuth connection, plus the
 * read-only promise, front and center.
 *
 * Advisory era: the ops-queue UI (tool cards, request composer, task list)
 * that used to live here is retired for now — with no write access anywhere,
 * Evolution guides instead of fulfilling. The queue plumbing (lib/tasks.ts,
 * the admin view) is intact; restore the task UI here when write access and
 * fulfillment ship.
 */
import { useEffect, useState } from "react";
import { ShopifyConnect } from "./ShopifyConnect";
import { auditAndSaveStore, type AuditReport, type ConnectedStore } from "../lib/store";

export function ToolsPanel({
  open,
  onClose,
  storeUrl,
  onDisconnected,
  onStoreUpdated,
  shopifyConnect = true,
}: {
  open: boolean;
  onClose: () => void;
  storeUrl: string | null;
  onDisconnected: () => void;
  /** Fired after the address is changed and a fresh audit saved. */
  onStoreUpdated?: (store: ConnectedStore, audit: AuditReport | null) => void;
  /** Operator-plan feature: the read-only Shopify OAuth connect. Free tier hides it. */
  shopifyConnect?: boolean;
}) {
  const [url, setUrl] = useState(storeUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync the field whenever the panel opens or the store changes upstream.
  useEffect(() => {
    setUrl(storeUrl ?? "");
    setError(null);
    setSaved(false);
  }, [storeUrl, open]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const { store, report, error: err } = await auditAndSaveStore(trimmed);
    setBusy(false);
    if (!store) {
      setError(err ?? "We couldn't scan that URL — double-check it and try again.");
      return;
    }
    setUrl(store.url);
    setSaved(true);
    onStoreUpdated?.(store, report);
  };

  return (
    <aside className={`tools-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="My store">
      <header className="tools-header">
        <h2>My store</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      <form className="shopify-connect" onSubmit={submit}>
        <p>
          <strong>Store address</strong> — your storefront's public URL (like
          mystore.com), the one shoppers visit. The free audit scans this
          address, so if the audit can't reach your store, fix it here.
        </p>
        <div className="shopify-connect-row">
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourstore.com"
            aria-label="Your store's public URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="primary" disabled={busy || !url.trim()}>
            {busy ? "Scanning…" : "Save & re-audit"}
          </button>
        </div>
        {saved && <p className="overlay-fineprint">✓ Store updated — a fresh audit is saved.</p>}
        {error && <p className="overlay-error">{error}</p>}
      </form>

      {shopifyConnect && <ShopifyConnect storeUrl={storeUrl} onDisconnected={onDisconnected} />}

      <p className="store-disclaimer">
        <strong>Read-only, by design.</strong> Evolution never edits or writes anything on your
        store. The connection only lets us read your data — products, orders, abandoned checkouts —
        so we can analyse your store properly and give you advice based on real numbers, not
        guesses.
      </p>
    </aside>
  );
}
