import { useEffect, useState, type FormEvent } from "react";
import { sendMagicLink } from "../lib/auth";

/**
 * Magic-link login — the only door into the app when auth is configured.
 * Deliberately tiny: one email field, one button. No passwords, no signup
 * form; the emailed link both registers and signs in, so every visitor who
 * gets past this screen is a captured lead.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Surface magic-link failures (expired/used link) that Supabase reports
  // back via the URL hash, e.g. #error_description=Email+link+is+invalid...
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const desc = params.get("error_description");
    if (desc) {
      setError(`${desc.replace(/\+/g, " ")} — request a fresh link below.`);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setError("That doesn't look like an email address.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendMagicLink(addr);
      setSentTo(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link — try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card card">
        <div className="login-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="loginWings" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffc83d" />
                <stop offset="52%" stopColor="#ff8a3d" />
                <stop offset="100%" stopColor="#ff5470" />
              </linearGradient>
            </defs>
            <path
              d="M12 5.5c-1-1.6-2.7-2.6-4.6-2.6C4.9 2.9 3 4.8 3 7.2c0 2.2 1.5 3.6 3.4 4.4C4.4 12 3 13.2 3 15.2c0 2.1 1.7 3.7 3.8 3.7 2.3 0 4.2-1.6 5.2-3.8V5.5z"
              fill="url(#loginWings)"
            />
            <path
              d="M12 5.5c1-1.6 2.7-2.6 4.6-2.6 2.5 0 4.4 1.9 4.4 4.3 0 2.2-1.5 3.6-3.4 4.4 2 .4 3.4 1.6 3.4 3.6 0 2.1-1.7 3.7-3.8 3.7-2.3 0-4.2-1.6-5.2-3.8V5.5z"
              fill="url(#loginWings)"
              opacity="0.78"
            />
            <circle cx="12" cy="4.4" r="1.5" fill="url(#loginWings)" />
          </svg>
        </div>

        <h1 className="login-word">Evolution</h1>

        {sentTo ? (
          <div className="login-sent" role="status">
            <p className="login-title">Check your inbox</p>
            <p className="login-sub">
              We sent a magic link to <strong>{sentTo}</strong>. Click it and
              you're in — no password needed.
            </p>
            <button type="button" className="link" onClick={() => setSentTo(null)}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <p className="login-sub">
              Enter your email and we'll send you a magic link — one click and
              you're in.
            </p>
            <form className="login-form" onSubmit={handleSubmit}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                autoFocus
                aria-label="Email address"
              />
              <button type="submit" className="login-btn" disabled={sending || !email.trim()}>
                {sending ? "Sending…" : "Send magic link"}
              </button>
            </form>
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>

      <nav className="login-links" aria-label="Site pages">
        <a href="pricing.html">Pricing</a>
        <a href="terms.html">Terms</a>
        <a href="privacy.html">Privacy</a>
        <a href="refund.html">Refunds</a>
      </nav>
    </div>
  );
}
