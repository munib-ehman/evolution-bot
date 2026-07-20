/**
 * Team email notifications via Resend — zero-dep, plain fetch, edge-safe.
 *
 * Deliberately optional: with no RESEND_API_KEY every helper returns false
 * and callers carry on (tasks still land in the admin queue at /app#/admin;
 * the founders just don't get pinged). Once the runevolution.io domain is
 * verified in Resend, setting the key turns notifications on with no deploy
 * changes. Before verification, RESEND_FROM=onboarding@resend.dev works for
 * testing.
 */

export interface EmailEnv {
  resendKey?: string;
  resendFrom?: string;
  /** Comma-separated override for who gets task notifications. */
  teamEmails?: string;
}

const TEAM_DEFAULT = "subhan@runevolution.io,muneeb@runevolution.io";
const FROM_DEFAULT = "Evolution <notifications@runevolution.io>";

export interface TaskEmailInfo {
  userEmail: string | null;
  shopDomain: string | null;
  tool: string;
  request: string;
  taskId: string | null;
  origin: string;
}

/** Best-effort: returns whether the email was accepted; never throws. */
export async function sendTaskEmail(env: EmailEnv, info: TaskEmailInfo): Promise<boolean> {
  if (!env.resendKey) return false;
  const lines = [
    `User: ${info.userEmail ?? "(unknown)"}`,
    `Store: ${info.shopDomain ?? "(none connected)"}`,
    `Tool: ${info.tool}`,
    "",
    "Request:",
    info.request,
    "",
    `Admin queue: ${info.origin}/app#/admin${info.taskId ? `  (task ${info.taskId})` : ""}`,
  ];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFrom || FROM_DEFAULT,
        to: (env.teamEmails || TEAM_DEFAULT).split(",").map((s) => s.trim()).filter(Boolean),
        subject: `[Evolution task] ${info.tool} — ${info.userEmail ?? "unknown user"}`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(6_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
