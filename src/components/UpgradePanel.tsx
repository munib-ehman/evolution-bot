/**
 * Billing placeholder — the $100/mo Operator plan card. If the Paddle client
 * vars are configured we open Paddle's overlay checkout (sandbox or live —
 * the same code, only the token changes); until then it's a contact CTA and
 * the team flips profiles.plan by hand in the Supabase Table Editor.
 */
import { useState } from "react";
import type { Plan } from "../lib/store";

const PADDLE_TOKEN = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? "").trim();
const PADDLE_PRICE_ID = (import.meta.env.VITE_PADDLE_PRICE_ID ?? "").trim();

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
  if (!open) return null;

  const paddleReady = Boolean(PADDLE_TOKEN && PADDLE_PRICE_ID);

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
            The operator is on the job — file tasks and Evolution works through them. Cancel anytime by
            emailing us.
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
            {paddleReady ? (
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
