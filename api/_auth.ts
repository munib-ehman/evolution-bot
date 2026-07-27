/**
 * Bearer auth for the cheap high-frequency proxies (/api/chat, /api/tts).
 *
 * The heavier routes resolve users through resolveUser/resolveUserFull in
 * _audit.ts (one GoTrue round trip per request — fine for a once-per-click
 * endpoint). TTS fires once PER SENTENCE, so this wraps the same resolver in
 * a small in-isolate token→userId cache.
 *
 * Deliberately NOT local JWT verification: Supabase's new key system may sign
 * access tokens asymmetrically, so the GoTrue lookup is the only scheme-proof
 * check. Trade-off of the cache: a revoked session stays usable for up to
 * CACHE_TTL_MS per warm isolate.
 */
import { resolveUser, type AuditEnv } from "./_audit";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map<string, { userId: string; exp: number }>();

export type AuthResult =
  | { ok: true; userId: string | null } // userId null = open demo deployment
  | { ok: false; status: 401 };

/**
 * Resolve the caller. Mirrors the client's `authEnabled` rule: when the
 * deployment has no Supabase configured, the app runs wide open with no login
 * gate, so the proxies stay open too.
 */
export async function requireUser(
  authHeader: string | null,
  env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey">,
): Promise<AuthResult> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return { ok: true, userId: null };

  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false, status: 401 };

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.exp > now) return { ok: true, userId: hit.userId };

  const userId = await resolveUser(env, authHeader);
  if (!userId) return { ok: false, status: 401 };

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(token, { userId, exp: now + CACHE_TTL_MS });
  return { ok: true, userId };
}

/**
 * Defense-in-depth against cross-site use from another origin: browsers send
 * Origin on cross-site POSTs; non-browser clients omit it (allowed — the
 * bearer is the real gate).
 */
export function sameOriginOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
