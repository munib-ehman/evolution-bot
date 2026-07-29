import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authEnabled, supabase } from "../lib/auth";
import { embeddedSignIn, isEmbedded } from "../lib/embedded";
import { captureUpgradeIntent } from "../lib/upgradeIntent";
import { Login } from "./Login";

/** Signed-in email, or null. Read anywhere via useAuthEmail(). */
const AuthEmailContext = createContext<string | null>(null);
export const useAuthEmail = () => useContext(AuthEmailContext);

/**
 * Wraps the app in the magic-link gate. With no Supabase config the gate is
 * transparent (the app stays a zero-signup demo). When configured, nothing —
 * not even the 3D model download — loads until the visitor signs in.
 *
 * Inside the Shopify admin (embedded install) there is no email login at
 * all: the App Bridge session token is exchanged for a Supabase session
 * automatically — the merchant installed the app, that IS the sign-in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // With auth off there's nothing to check; start "checked" so we never blank.
  const [checked, setChecked] = useState(!authEnabled);
  const [email, setEmail] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [embedAttempt, setEmbedAttempt] = useState(0);

  // Park a pricing-CTA ?upgrade=1 before the login gate can eat it — the
  // magic-link redirect drops the query string (see lib/upgradeIntent).
  useEffect(() => {
    captureUpgradeIntent();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    // Restore any existing session, then follow sign-ins (including the one
    // supabase-js creates itself when a magic link lands us back here).
    void supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
      setChecked(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Embedded auto-login: no session yet → swap the App Bridge session token
  // for one. Never show the email form inside the admin iframe.
  useEffect(() => {
    if (!checked || email || !authEnabled || !isEmbedded()) return;
    let cancelled = false;
    setEmbedError(null);
    void embeddedSignIn().then((err) => {
      if (!cancelled && err) setEmbedError(err);
      // Success needs no state change here — onAuthStateChange sets the email.
    });
    return () => {
      cancelled = true;
    };
  }, [checked, email, embedAttempt]);

  if (!checked) return null; // session check is a local read — resolves in a blink

  if (authEnabled && !email && isEmbedded()) {
    return (
      <div className="embed-connect" role="status">
        {embedError ? (
          <>
            <p>{embedError}</p>
            <button type="button" className="primary" onClick={() => setEmbedAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        ) : (
          <p>Connecting to your store…</p>
        )}
      </div>
    );
  }

  if (authEnabled && !email) return <Login />;

  return <AuthEmailContext.Provider value={email}>{children}</AuthEmailContext.Provider>;
}
