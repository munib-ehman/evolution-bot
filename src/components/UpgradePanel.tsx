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
 *   Everyone else gets the Paddle overlay checkout if the client vars are
 *   configured (sandbox or live — same code, only the token changes), and a
 *   contact CTA until then (the team flips profiles.plan by hand).
 */
import { useEffect, useState } from "react";
import type { Plan } from "../lib/store";
import { getShopifyStatus } from "../lib/shopify";
import { isEmbedded } from "../lib/embedded";

const PADDLE_TOKEN = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? "").trim();
const PADDLE_PRICE_ID = (import.meta.env.VITE_PADDLE_PRICE_ID ?? "").trim();
/** The app's handle on the Shopify App Store (Partner Dashboard → app URL slug). */
const SHOPIFY_APP_HANDLE = (import.meta.env.VITE_SHOPIFY_APP_HANDLE ?? "").trim();

declare global {
  interface Window {
    Paddle?: {
      Initialize: (opts: { token: string }) => void;
      Checkout: { open: (opts: { items: { priceId: string; quantity: number }[] }) => void };
    };
  }
}

let paddleLoaded: Promise<void> | null = null;
function loadPaddle(): Promise<void> {
  paddleLoaded ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      window.Paddle?.Initialize({ token: PADDLE_TOKEN });
      resolve();
    };
    script.onerror = () => reject(new Error("Couldn't load the payment form."));
    document.head.appendChild(script);
  });
  return paddleLoaded;
}

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
  // undefined = still looking the connection up; null = not connected.
  const [shopDomain, setShopDomain] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    void getShopifyStatus().then((status) => setShopDomain(status?.shop_domain ?? null));
  }, [open]);

  if (!open) return null;

  const paddleReady = Boolean(PADDLE_TOKEN && PADDLE_PRICE_ID);
  const storeHandle = shopDomain ? shopDomain.replace(".myshopify.com", "") : null;
  const shopifyPricingUrl =
    storeHandle && SHOPIFY_APP_HANDLE
      ? `https://admin.shopify.com/store/${storeHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`
      : null;

  const checkout = async () => {
    try {
      await loadPaddle();
      window.Paddle?.Checkout.open({ items: [{ priceId: PADDLE_PRICE_ID, quantity: 1 }] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open checkout.");
    }
  };

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
          <p className="overlay-lede">
            The operator is on the job — file tasks and Evolution works through them.{" "}
            {shopDomain
              ? "Manage or cancel the subscription any time from your Shopify admin."
              : "Cancel anytime by emailing us."}
          </p>
        ) : (
          <>
            <p className="plan-price">
              <strong>$100</strong>/month · cancel anytime
            </p>
            <ul className="plan-list">
              <li>All six tools, fulfilled for you: product research, cart recovery, support, retention, back-in-stock, true profit.</li>
              <li>Evolution does the work — you approve, it ships.</li>
              <li>You only pay when it works. No setup fees.</li>
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
            ) : paddleReady ? (
              <button type="button" className="primary" onClick={() => void checkout()}>
                Start with the Operator
              </button>
            ) : (
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
