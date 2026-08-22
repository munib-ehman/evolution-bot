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
import type { Entitlements, ManagerRole, Plan } from "../lib/store";
import { getShopifyStatus } from "../lib/shopify";
import { isEmbedded } from "../lib/embedded";
import { supabase } from "../lib/auth";

/** The app's handle on the Shopify App Store (Partner Dashboard → app URL slug). */
const SHOPIFY_APP_HANDLE = (import.meta.env.VITE_SHOPIFY_APP_HANDLE ?? "").trim();
const ROLE_OPTIONS: Record<ManagerRole, { name: string; short: string; description: string }> = {
  marketing: { name: "Marketing Manager", short: "MK", description: "Recovers abandoned carts, builds win-back campaigns, and prepares targeted broadcasts for your approval." },
  "customer-success": { name: "Customer Success Manager", short: "CS", description: "Finds customers needing attention, prepares support responses, and runs retention and review workflows." },
  seo: { name: "SEO Manager", short: "SEO", description: "Audits product visibility, researches search opportunities, and prepares safe SEO and GEO improvements." },
  product: { name: "Product Manager", short: "PM", description: "Researches product opportunities, improves listings, and proposes collections and merchandising changes." },
  operations: { name: "Operations Manager", short: "OPS", description: "Monitors fulfillment, inventory, returns, and order risks, then prepares the safest next action." },
};

export function UpgradePanel({
  open,
  onClose,
  plan,
  email,
  entitlements,
  selectedRole,
  closable = true,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  email: string | null;
  entitlements: Entitlements;
  selectedRole: ManagerRole;
  closable?: boolean;
  onSignOut?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosenRoles,setChosenRoles]=useState<ManagerRole[]>([selectedRole]);
  // undefined = still looking the connection up; null = not connected.
  const [shopDomain, setShopDomain] = useState<string | null | undefined>(undefined);
  // undefined = probing /api/polar-checkout; false = not deployed/configured.
  const [polarReady, setPolarReady] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    try { localStorage.removeItem("evolution-manager-checkout-queue"); } catch { /* storage unavailable */ }
    setChosenRoles(entitlements[selectedRole] ? [] : [selectedRole]);
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
  const openPolar = async (endpoint: string, failMsg: string, roles?:ManagerRole[]) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const token = data?.session?.access_token;
      if (!token) throw new Error("Sign in first, then try again.");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: roles?JSON.stringify({roles}):undefined,
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? failMsg);
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg);
      setBusy(false);
    }
  };
  const checkout = (roles:ManagerRole[]) => openPolar("/api/polar-checkout", "Couldn't open checkout.",roles);
  const portal = () => openPolar("/api/polar-portal", "Couldn't open the billing portal.");

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Upgrade">
      <div className="overlay-card card upgrade-dialog">
        <header className="tools-header">
          <h2>{Object.values(entitlements).some(Boolean) ? "Your managers" : "Choose your manager"}</h2>
          {closable ? <button type="button" className="link" onClick={onClose}>close</button> : onSignOut ? <button type="button" className="link" onClick={onSignOut}>Sign out</button> : null}
        </header>

        {Object.values(entitlements).every(Boolean) ? (
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
            <p className="upgrade-lede">Select one or more specialists at $50 each per month. They are billed together as one monthly subscription.</p>
            <div className="manager-plan-grid" role="group" aria-label="Available managers">
              {(Object.keys(ROLE_OPTIONS) as ManagerRole[]).map((role) => {
                const option = ROLE_OPTIONS[role];
                const active = entitlements[role];
                const selected = chosenRoles.includes(role);
                return (
                  <button type="button" className={`manager-plan-card ${selected ? "selected" : ""} ${active ? "active" : ""}`} key={role} role="checkbox" aria-checked={selected} disabled={active} onClick={() => setChosenRoles(current => current.includes(role) ? current.filter(item => item !== role) : [...current, role])}>
                    <span className="manager-plan-icon">{option.short}</span>
                    <span className="manager-plan-copy">
                      <span className="manager-plan-title"><strong>{option.name}</strong><b>{active ? "Active" : "$50/mo"}</b></span>
                      <span>{option.description}</span>
                    </span>
                    <span className="manager-plan-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="upgrade-selection">
              <span><small>{chosenRoles.length} manager{chosenRoles.length===1?"":"s"} selected</small><strong>{chosenRoles.length ? chosenRoles.map(role=>ROLE_OPTIONS[role].name).join(", ") : "Select at least one manager"}</strong></span>
              <b>${chosenRoles.length*50} <small>USD / month</small></b>
            </div>
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
                  Continue in Shopify
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
              <button type="button" className="primary" disabled={busy||chosenRoles.length===0} onClick={() => void checkout(chosenRoles)}>
                {busy ? "Opening checkout…" : `Continue — $${chosenRoles.length*50}/month`}
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
