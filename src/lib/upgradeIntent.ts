/**
 * The pricing page's "Start your operator" CTA lands on app?upgrade=1 — but a
 * first-time buyer hits the login gate there, and the magic-link round trip
 * strips the query string (emailRedirectTo is origin+pathname; Supabase's
 * redirect allow-list makes carrying params fragile). So the intent is parked
 * in localStorage while they sign in — it survives the magic link opening in
 * a fresh tab — and consumed on the first authenticated load.
 */

// Key is mirrored by the inline capture script in public/pricing.html — the
// pricing page writes it on CTA click so the intent survives even when the
// query param never reaches the app. Keep the two in sync.
const KEY = "evolution-upgrade-intent";
// Long enough for "email arrives, link clicked over coffee"; short enough
// that the panel never pops on an unrelated visit days later.
const TTL_MS = 60 * 60 * 1000;

/** Call before the login gate: remember that this visit came here to buy. */
export function captureUpgradeIntent(): void {
  try {
    if (new URLSearchParams(window.location.search).get("upgrade") === "1") {
      localStorage.setItem(KEY, String(Date.now()));
    }
  } catch {
    // Storage blocked (private mode) — the URL param path still works.
  }
}

/** One-shot read: true if a fresh intent was parked; always clears it. */
export function consumeUpgradeIntent(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    localStorage.removeItem(KEY);
    return Date.now() - Number(raw) < TTL_MS;
  } catch {
    return false;
  }
}
