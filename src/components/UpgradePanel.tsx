/**
 * Billing — the $100/mo Operator plan card, with two mutually exclusive
 * checkout paths:
 *
 *   Shopify-connected accounts (App Store installs, or standalone users who
 *   connected their store) are billed through Shopify App Pricing — App Store
 *   policy forbids off-platform billing for them, so the card deep-links to
 *   the app's plan page inside their Shopify admin and the
 *   app_subscriptions/update webhook flips profiles.plan when they approve.
 *
 *   Everyone else gets Polar hosted checkout (merchant of record) when the
 *   server has the Polar vars configured — /api/polar-checkout mints the
 *   session and the polar-webhook flips profiles.plan on subscription.active.
 *   Until it's configured, a contact CTA (the team flips the plan by hand).
 */
import { useEffect, useState } from "react";
import type { Plan } from "../lib/store";
import { getShopifyStatus } from "../lib/shopify";
import { isEmbedded } from "../lib/embedded";
import { supabase } from "../lib/auth";

/** The app's handle on the Shopify App Store (Partner Dashboard → app URL slug). */
const SHOPIFY_APP_HANDLE = (import.meta.env.VITE_SHOPIFY_APP_HANDLE ?? "").trim();

export function UpgradePanel({
  open,
  onClose,
  plan,
  email,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  email: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined = still looking the connection up; null = not connected.
  const [shopDomain, setShopDomain] = useState<string | null | undefined>(undefined);
  // undefined = probing /api/polar-checkout; false = not deployed/configured.
  const [polarReady, setPolarReady] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    void getShopifyStatus().then((status) => setShopDomain(status?.shop_domain ?? null));
    void fetch("/api/polar-checkout", { method: "GET" })
      .then((res) => setPolarReady(res.status === 204))
      .catch(() => setPolarReady(false));
  }, [open]);

  if (!open) return null;

  const storeHandle = shopDomain ? shopDomain.replace(".myshopify.com", "") : null;
  const shopifyPricingUrl =
    storeHandle && SHOPIFY_APP_HANDLE
      ? `https://admin.shopify.com/store/${storeHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`
      : null;

  // Checkout and the customer portal are the same dance: authed POST → Polar
  // hands back a hosted URL → we send the browser there.
  const openPolar = async (endpoint: string, failMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const token = data?.session?.access_token;
      if (!token) throw new Error("Sign in first, then try again.");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? failMsg);
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg);
      setBusy(false);
    }
  };
  const checkout = () => openPolar("/api/polar-checkout", "Couldn't open checkout.");
  const portal = () => openPolar("/api/polar-portal", "Couldn't open the billing portal.");

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Upgrade">
      <div className="overlay-card card">
        <header className="tools-header">
          <h2>{plan === "operator" ? "You're on Operator" : "Upgrade to Operator"}</h2>
          <button type="button" className="link" onClick={onClose}>
            close
          </button>
        </header>

        {plan === "operator" ? (
          <>
            <p className="overlay-lede">
              Your operator is running — the software executes the busywork and you approve every action.{" "}
              {shopDomain
                ? "Manage or cancel the subscription any time from your Shopify admin."
                : "Manage or cancel the subscription any time below."}
            </p>
            {shopDomain === undefined ? null : shopDomain ? (
              shopifyPricingUrl && (
                <a
                  className="primary as-link"
                  href={shopifyPricingUrl}
                  target={isEmbedded() ? "_top" : "_blank"}
                  rel="noreferrer"
                >
                  Manage your plan in Shopify
                </a>
              )
            ) : (
              <button type="button" className="primary" disabled={busy} onClick={() => void portal()}>
                {busy ? "Opening the billing portal…" : "Manage subscription"}
              </button>
            )}
            {error && <p className="overlay-error">{error}</p>}
          </>
        ) : (
          <>
            <p className="plan-price">
              <strong>$100</strong>/month · cancel anytime
            </p>
            <ul className="plan-list">
              <li>Automated cart recovery</li>
              <li>Automated customer retention (win-backs + review requests)</li>
              <li>Fulfillment operations dashboard</li>
              <li>One dashboard, with your approval on every action</li>
              <li>Instant access the moment you subscribe. 14-day money-back guarantee.</li>
            </ul>
            {shopDomain === undefined ? null : shopDomain ? (
              // Shopify-connected → Shopify App Pricing is the ONLY checkout
              // (App Store policy). _top escapes the admin iframe to the plan
              // page; Shopify sends the merchant back after approving.
              shopifyPricingUrl ? (
                <a
                  className="primary as-link"
                  href={shopifyPricingUrl}
                  target={isEmbedded() ? "_top" : "_blank"}
                  rel="noreferrer"
                >
                  Choose your plan in Shopify
                </a>
              ) : (
                <a
                  className="primary as-link"
                  href={`mailto:muneeb@runevolution.io?subject=Operator%20plan&body=I%20want%20the%20Operator%20plan.%20My%20store%3A%20${encodeURIComponent(shopDomain)}`}
                >
                  Email us to activate — we set you up same-day
                </a>
              )
            ) : polarReady ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void checkout()}>
                {busy ? "Opening checkout…" : "Start with the Operator"}
              </button>
            ) : polarReady === undefined ? null : (
              <a
                className="primary as-link"
                href={`mailto:muneeb@runevolution.io?subject=Operator%20plan&body=I%20want%20the%20Operator%20plan.%20My%20account%3A%20${encodeURIComponent(email ?? "")}`}
              >
                Email us to activate — we set you up same-day
              </a>
            )}
            {error && <p className="overlay-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
