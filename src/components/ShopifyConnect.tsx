/**
 * "Connect Shopify" card — upgrades a paste-URL store to a real read-only
 * OAuth connection so the audit sees orders and abandoned checkouts.
 * Renders nothing until it knows the server is configured for it, and shows
 * a quiet "connected" line once the OAuth loop has completed.
 */
import { useEffect, useState } from "react";
import {
  getShopifyStatus,
  shopifyConnectAvailable,
  startShopifyConnect,
  type ShopifyStatus,
} from "../lib/shopify";

export function ShopifyConnect({ storeUrl }: { storeUrl: string | null }) {
  const [available, setAvailable] = useState(false);
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
    return (
      <p className="shopify-connected">
        ✓ Shopify connected: <strong>{status.shop_domain}</strong> — your audits now use real
        orders and abandoned-checkout data.
      </p>
    );
  }
  if (!available) return null;

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
      <p>
        <strong>Connect Shopify</strong> — read-only. Unlocks the deep audit: your real abandoned
        checkouts, revenue, and repeat-customer rate.
      </p>
      <div className="shopify-connect-row">
        <input
          type="text"
          placeholder="yourstore.myshopify.com"
          aria-label="Your .myshopify.com domain"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !shop.trim()}>
          {busy ? "Opening Shopify…" : "Connect"}
        </button>
      </div>
      {error && <p className="overlay-error">{error}</p>}
    </form>
  );
}
