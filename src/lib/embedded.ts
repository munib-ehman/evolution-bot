/**
 * Embedded mode — the app running inside the Shopify admin (App Store
 * installs). app.html loads Shopify's app-bridge.js first; when the page is
 * framed by the admin, App Bridge exposes window.shopify and appends ?host=
 * (and embedded=1) to our URL. In that context there is no email login:
 * embeddedSignIn() swaps an App Bridge session token for a Supabase session
 * via /api/shopify-session — see api/_embedded.ts for the server half.
 */
import { supabase } from "./auth";

declare global {
  interface Window {
    shopify?: {
      idToken?: () => Promise<string>;
    };
  }
}

let embeddedCache: boolean | null = null;

/** Are we running inside the Shopify admin iframe? */
export function isEmbedded(): boolean {
  // Shopify always appends host= to the app URL; the window.self check guards
  // against someone pasting an app URL with a stray host param. Cached on
  // first call — the SPA strips query params after handling them, but a
  // document never stops (or starts) being framed.
  embeddedCache ??=
    new URLSearchParams(window.location.search).has("host") && window.self !== window.top;
  return embeddedCache;
}

/**
 * Auto-login for the embedded app: App Bridge session token → server
 * verification (+ store connect via token exchange on first install) →
 * magic-link token_hash → real Supabase session. Returns an error message,
 * or null on success (AuthGate's onAuthStateChange picks up the session).
 */
export async function embeddedSignIn(): Promise<string | null> {
  if (!supabase) return "Login isn't configured.";
  try {
    const idToken = await window.shopify?.idToken?.();
    if (!idToken) return "Couldn't reach the Shopify admin — reload the page.";

    const res = await fetch("/api/shopify-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: idToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { token_hash?: string; error?: string };
    if (!res.ok || !body.token_hash) {
      return body.error ?? "Couldn't connect to your store — try reopening the app.";
    }

    const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: body.token_hash });
    if (error) return error.message;
    return null;
  } catch {
    return "Couldn't connect to your store — try reopening the app.";
  }
}
