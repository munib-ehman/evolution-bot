/**
 * The internal ops queue — rendered at /app#/admin for the team only.
 * The email check here is cosmetic routing; the real gate is the admin RLS
 * policies in supabase/2026-07-18_shell.sql (non-admins get zero rows).
 * A plain table on purpose: this is an internal tool.
 */
import { useEffect, useState } from "react";
import { adminContext, listAllTasks, updateTask, TOOLS, type OpsTask, type TaskStatus } from "../lib/tasks";

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS ?? "")
  .split(",")
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email: string | null): boolean {
  return Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
}

export function AdminQueue() {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [emails, setEmails] = useState<Map<string, string>>(new Map());
  const [stores, setStores] = useState<Map<string, string>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const refresh = async () => {
    const [all, ctx] = await Promise.all([listAllTasks(), adminContext()]);
    setTasks(all);
    setEmails(ctx.emails);
    setStores(ctx.stores);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (task: OpsTask, status: TaskStatus) => {
    const result = (drafts[task.id] ?? task.result ?? "").trim() || null;
    const ok = await updateTask(task.id, status, result);
    setNote(ok ? `Saved "${task.id.slice(0, 8)}" → ${status}` : "Save failed — are you signed in as an admin?");
    if (ok) void refresh();
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>Ops queue</h1>
        <div>
          <button type="button" className="link" onClick={() => void refresh()}>
            refresh
          </button>{" "}
          · <a href="#" onClick={() => { location.hash = ""; location.reload(); }}>back to app</a>
        </div>
      </header>
      {note && <p className="admin-note">{note}</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Owner</th>
            <th>Store</th>
            <th>Tool</th>
            <th>Request</th>
            <th>Result</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={`row-${t.status}`}>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td>{emails.get(t.user_id) || t.user_id.slice(0, 8)}</td>
              <td>{stores.get(t.user_id) || "—"}</td>
              <td>{TOOLS.find((x) => x.key === t.tool)?.name ?? t.tool}</td>
              <td className="admin-request">{t.request}</td>
              <td>
                <textarea
                  rows={3}
                  defaultValue={t.result ?? ""}
                  placeholder="Result — posts back to the owner"
                  onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                />
              </td>
              <td>
                <select
                  value={t.status}
                  onChange={(e) => void save(t, e.target.value as TaskStatus)}
                >
                  <option value="new">new</option>
                  <option value="in_progress">in progress</option>
                  <option value="done">done</option>
                </select>
                <button type="button" className="link" onClick={() => void save(t, t.status)}>
                  save
                </button>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={7}>Queue is empty (or you're not signed in as an admin).</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
