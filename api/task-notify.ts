/**
 * /api/task-notify — email the team about a task the owner just filed from
 * the Tasks panel (skill-run escalations email inline; this covers the
 * panel's direct Supabase inserts, which the server never sees).
 *
 * POST { taskId } with the owner's bearer token. The server re-reads the
 * task via the service role, scoped to the resolved user — the client can
 * only trigger notifications about its own tasks, and the email content
 * comes from the database row, not the request. Best-effort by design:
 * always 204 on auth'd requests so the panel never surfaces email noise.
 */
import { resolveUserFull } from "./_audit";
import { sendTaskEmail } from "./_email";
import { skillEnvFromProcess } from "./_skills";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = skillEnvFromProcess();

  let taskId = "";
  try {
    const body = (await req.json()) as { taskId?: unknown };
    taskId = typeof body.taskId === "string" ? body.taskId : "";
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return new Response(null, { status: 400 });

  const user = await resolveUserFull(env, req.headers.get("authorization"));
  if (!user) return new Response(null, { status: 401 });

  if (env.resendKey && env.supabaseUrl && env.serviceRoleKey) {
    try {
      const res = await fetch(
        `${env.supabaseUrl}/rest/v1/tasks?id=eq.${taskId}&user_id=eq.${user.id}&select=tool,request&limit=1`,
        {
          headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
          signal: AbortSignal.timeout(4_000),
        },
      );
      const rows = res.ok ? ((await res.json()) as { tool?: string; request?: string }[]) : [];
      const task = rows[0];
      if (task) {
        await sendTaskEmail(env, {
          userEmail: user.email,
          shopDomain: null,
          tool: task.tool ?? "custom",
          request: task.request ?? "",
          taskId,
          origin: new URL(req.url).origin,
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return new Response(null, { status: 204 });
}
