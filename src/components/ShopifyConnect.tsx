/** Shopify admin OAuth connection. Access tokens remain server-side. */
import { useEffect, useState } from "react";
import {
  disconnectShopify,
  getShopifyStatus,
  shopifyConnectAvailable,
  startShopifyConnect,
  type ShopifyStatus,
} from "../lib/shopify";

export function ShopifyConnect({
  storeUrl,
  onDisconnected,
}: {
  storeUrl: string | null;
  /** Fired after a successful disconnect so the app can reset store state. */
  onDisconnected?: () => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ShopifyStatus | null>(null);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [avail, conn] = await Promise.all([shopifyConnectAvailable(), getShopifyStatus()]);
      setAvailable(avail);
      setStatus(conn);
      const host = storeUrl?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? "";
      if (host.endsWith(".myshopify.com")) setShop(host);
    })();
  }, [storeUrl]);

  if (status) {
    const reconnect = async () => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const err = await startShopifyConnect(status.shop_domain);
      // On success the browser navigates to Shopify; reaching here = failure.
      if (err) {
        setError(err);
        setBusy(false);
      }
    };
    const disconnect = async () => {
      if (busy) return;
      const sure = window.confirm(
        `Disconnect ${status.shop_domain}? Evolution will lose access to this store. You can connect this or another store again anytime.`,
      );
      if (!sure) return;
      setBusy(true);
      setError(null);
      const ok = await disconnectShopify();
      setBusy(false);
      if (ok) {
        setStatus(null);
        setShop("");
        onDisconnected?.();
      } else {
        setError("Couldn't disconnect — try again in a moment.");
      }
    };
    return (
      <div className="shopify-connected">
        <p>
          ✓ Shopify connected: <strong>{status.shop_domain}</strong> — {status.capabilities.operatorReady
            ? "Evolution can prepare changes and applies them only after your approval."
            : "reconnect once to approve the latest app permissions, including customer unsubscribe sync."}{" "}
          <button type="button" className="link" onClick={() => void reconnect()} disabled={busy}>
            {busy ? "Working…" : "Reconnect"}
          </button>
          {" · "}
          <button type="button" className="link" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </button>
        </p>
        {error && <p className="overlay-error">{error}</p>}
      </div>
    );
  }
  if (available === null) return <p className="overlay-fineprint">Checking Shopify connection…</p>;
  if (!available) {
    return <p className="overlay-error">Shopify connection is not configured on this deployment.</p>;
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!shop.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await startShopifyConnect(shop.trim());
    // On success the browser navigates away; reaching here means it didn't.
    if (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="shopify-connect" onSubmit={submit}>
      <div className="shopify-connect-row">
        <input
          type="text"
          placeholder="your-store.myshopify.com"
          aria-label="Your .myshopify.com domain"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !shop.trim()}>
          {busy ? "Opening Shopify…" : "Continue"}
        </button>
      </div>
      {error && <p className="overlay-error">{error}</p>}
    </form>
  );
}
