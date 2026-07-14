/**
 * Magic-link auth via Supabase, read from Vite env vars at build time.
 * Like the LLM config, it's OPTIONAL: leave the vars unset and the app runs
 * wide open with no login gate — zero signup, zero cost. Configure a free
 * Supabase project to gate the app behind an email magic link; every email
 * that signs in shows up in the Supabase dashboard (Authentication → Users).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
// Supabase is migrating key names: new projects get an sb_publishable_… key,
// older docs/projects call the same thing the "anon" key. Accept either.
const anonKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ""
).trim();

/** True when a Supabase project is configured — the login gate is active. */
export const authEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url, anonKey)
  : null;

/** Email the user a one-click sign-in link that lands back on this page. */
export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error("Login isn't configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
