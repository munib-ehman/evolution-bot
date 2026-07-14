import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authEnabled, supabase } from "../lib/auth";
import { Login } from "./Login";

/** Signed-in email, or null. Read anywhere via useAuthEmail(). */
const AuthEmailContext = createContext<string | null>(null);
export const useAuthEmail = () => useContext(AuthEmailContext);

/**
 * Wraps the app in the magic-link gate. With no Supabase config the gate is
 * transparent (the app stays a zero-signup demo). When configured, nothing —
 * not even the 3D model download — loads until the visitor signs in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // With auth off there's nothing to check; start "checked" so we never blank.
  const [checked, setChecked] = useState(!authEnabled);
  const [email, setEmail] = useState<string | null>(null);

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

  if (!checked) return null; // session check is a local read — resolves in a blink
  if (authEnabled && !email) return <Login />;

  return <AuthEmailContext.Provider value={email}>{children}</AuthEmailContext.Provider>;
}
