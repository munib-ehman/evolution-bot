/** Server-side role entitlements. UI visibility is never an authorization boundary. */
import { log } from "./_log";
import type { AuditEnv } from "./_audit";

export const ROLES = ["marketing", "customer-success", "seo", "product", "operations"] as const;
export type Role = (typeof ROLES)[number];
export type Entitlements = Record<Role, boolean>;

export const emptyEntitlements = (): Entitlements => ({
  marketing: false,
  "customer-success": false,
  seo: false,
  product: false,
  operations: false,
});

export function roleRequired(role: Role) {
  return {
    status: 403,
    body: {
      error: `The ${role} manager is not active for this account.`,
      needsUpgrade: true,
      requiredRole: role,
    },
  } as const;
}

const admins = (env: Pick<AuditEnv, "adminEmails">, email?: string | null) =>
  Boolean(email && (env.adminEmails ?? "").split(",").some((item) => item.trim().toLowerCase() === email.toLowerCase()));

export async function getEntitlements(
  env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey" | "adminEmails">,
  userId: string,
  userEmail?: string | null,
): Promise<Entitlements> {
  const result = emptyEntitlements();
  if (admins(env, userEmail) || !env.supabaseUrl || !env.serviceRoleKey) {
    for (const role of ROLES) result[role] = true;
    return result;
  }
  const key = env.serviceRoleKey;
  const headers = { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }) };
  try {
    const [rolesResponse, profileResponse] = await Promise.all([
      fetch(`${env.supabaseUrl}/rest/v1/role_entitlements?user_id=eq.${userId}&status=eq.active&select=role`, { headers, signal: AbortSignal.timeout(4_000) }),
      fetch(`${env.supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=plan&limit=1`, { headers, signal: AbortSignal.timeout(4_000) }),
    ]);
    if (rolesResponse.ok) {
      const rows = await rolesResponse.json() as { role?: string }[];
      for (const row of rows) if (ROLES.includes(row.role as Role)) result[row.role as Role] = true;
      return result;
    }
    // Safe rollout compatibility: before the migration is deployed, an existing
    // Operator keeps access. Once role_entitlements exists, it is authoritative.
    if (profileResponse.ok) {
      const rows = await profileResponse.json() as { plan?: string }[];
      if (rows[0]?.plan === "operator") for (const role of ROLES) result[role] = true;
    }
    return result;
  } catch {
    log("warn", "plan", "entitlement_lookup_unreachable", {});
    return result;
  }
}

export async function hasRole(env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey" | "adminEmails">, userId: string, role: Role, email?: string | null) {
  return (await getEntitlements(env, userId, email))[role];
}

/** Transitional helper for free research limits only. Never use for feature authorization. */
export async function isOperator(env: Pick<AuditEnv, "supabaseUrl" | "serviceRoleKey" | "adminEmails">, userId: string, email?: string | null) {
  return Object.values(await getEntitlements(env, userId, email)).some(Boolean);
}

/** Kept only so older call sites fail closed while they are migrated. */
export const OPERATOR_REQUIRED = { status: 403, body: { error: "This manager is not active for this account.", needsUpgrade: true } } as const;
