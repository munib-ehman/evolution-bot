/**
 * Paste-URL store onboarding — the "connect store" step of the shell.
 * Shown as an overlay (the avatar keeps loading behind it) when a signed-in
 * owner has no store row yet. If the free-audit funnel stashed a report in
 * localStorage, we prefill the URL and re-run the audit under their account
 * so the saved row is attributed to them.
 */
import { useEffect, useState } from "react";
import {
  connectStore,
  runAuditAsUser,
  PENDING_AUDIT_KEY,
  type ConnectedStore,
  type AuditReport,
} from "../lib/store";

interface PendingAudit {
  url?: string;
  report?: AuditReport;
}

function loadPending(): PendingAudit | null {
  try {
    const raw = localStorage.getItem(PENDING_AUDIT_KEY);
    return raw ? (JSON.parse(raw) as PendingAudit) : null;
  } catch {
    return null;
  }
}

export function ConnectStore({
  onConnected,
}: {
  onConnected: (store: ConnectedStore, audit: AuditReport | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromAudit, setFromAudit] = useState(false);

  useEffect(() => {
    const pending = loadPending();
    if (pending?.url) {
      setUrl(pending.url);
      setFromAudit(true);
    }
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);

    // Re-running the audit signed-in both validates the URL and attributes
    // the saved report to this account. Template prose keeps it fast enough.
    const audit = await runAuditAsUser(trimmed);
    const store = await connectStore(
      audit?.storeUrl ?? trimmed,
      audit?.platform,
    );

    if (!store) {
      setBusy(false);
      setError("Couldn't save your store — check the URL and try again.");
      return;
    }
    try {
      localStorage.removeItem(PENDING_AUDIT_KEY);
    } catch {
      /* ignore */
    }
    onConnected(store, audit);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Connect your store">
      <div className="overlay-card card">
        <h2>Connect your store</h2>
        <p className="overlay-lede">
          {fromAudit
            ? "Welcome back — this is the store from your free audit. Confirm it and Evolution takes it from here."
            : "Paste your store's web address. Evolution scans it, runs your audit, and gets to work — nothing to install."}
        </p>
        <form className="overlay-form" onSubmit={submit}>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourstore.com"
            aria-label="Your store URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="primary" disabled={busy || !url.trim()}>
            {busy ? "Scanning your store…" : "Connect store"}
          </button>
        </form>
        {error && <p className="overlay-error">{error}</p>}
        <p className="overlay-fineprint">
          Read-only and public data for now. Shopify login connect is coming — you'll be asked before
          Evolution ever changes anything.
        </p>
      </div>
    </div>
  );
}
