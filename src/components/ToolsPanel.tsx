/**
 * The Tasks panel — the owner-facing face of the ops queue. Six tool cards
 * (one per vertical), a request composer, and the task list with status.
 * Behind the scenes every request is fulfilled concierge-style by the team
 * (the admin queue); the owner just experiences "the operator handles it."
 *
 * Stays mounted so the 30s poll can spot tasks flipping to done even while
 * the panel is closed and surface the result in the chat.
 */
import { useEffect, useRef, useState } from "react";
import { createTask, listTasks, notifyTeam, TOOLS, type OpsTask } from "../lib/tasks";
import type { Plan } from "../lib/store";
import { ShopifyConnect } from "./ShopifyConnect";

const POLL_MS = 30_000;

const STATUS_LABEL: Record<OpsTask["status"], string> = {
  new: "queued",
  in_progress: "in progress",
  done: "done",
};

export function ToolsPanel({
  open,
  onClose,
  plan,
  storeId,
  storeUrl,
  onTaskDone,
  onUpgrade,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  storeId: string | null;
  storeUrl: string | null;
  onTaskDone: (task: OpsTask) => void;
  onUpgrade: () => void;
}) {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [tool, setTool] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  // Statuses we've already seen, so a poll can spot new→done transitions.
  const seenRef = useRef<Map<string, OpsTask["status"]> | null>(null);
  const onTaskDoneRef = useRef(onTaskDone);
  onTaskDoneRef.current = onTaskDone;

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const fresh = await listTasks();
      if (!alive) return;
      const seen = seenRef.current;
      if (seen) {
        for (const t of fresh) {
          if (t.status === "done" && seen.get(t.id) !== "done" && seen.has(t.id)) {
            onTaskDoneRef.current(t);
          }
        }
      }
      seenRef.current = new Map(fresh.map((t) => [t.id, t.status]));
      setTasks(fresh);
    };
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const pickTool = (key: string) => {
    setTool(key);
    setRequest(TOOLS.find((t) => t.key === key)?.starter ?? "");
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!tool || !request.trim() || busy) return;
    setBusy(true);
    const task = await createTask(tool, request.trim(), storeId);
    setBusy(false);
    if (task) {
      seenRef.current?.set(task.id, task.status);
      setTasks((prev) => [task, ...prev]);
      setTool(null);
      setRequest("");
      void notifyTeam(task.id); // email the founders (no-op without Resend)
    }
  };

  return (
    <aside className={`tools-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Tasks">
      <header className="tools-header">
        <h2>Tasks</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      {plan === "free" && (
        <button type="button" className="plan-banner" onClick={onUpgrade}>
          You're on the <strong>Free</strong> plan — fulfillment needs the <strong>Operator</strong> plan
          ($100/mo). Your first request is reviewed free. <span className="link">Upgrade →</span>
        </button>
      )}

      <ShopifyConnect storeUrl={storeUrl} />

      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tool-card ${tool === t.key ? "selected" : ""}`}
            onClick={() => pickTool(t.key)}
          >
            <strong>{t.name}</strong>
            <span>{t.blurb}</span>
          </button>
        ))}
      </div>

      {tool && (
        <form className="task-compose" onSubmit={submit}>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={3}
            aria-label="What should the operator do?"
            disabled={busy}
          />
          <div className="task-compose-row">
            <button type="button" className="link" onClick={() => setTool(null)}>
              cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !request.trim()}>
              {busy ? "Queuing…" : "Send to the operator"}
            </button>
          </div>
        </form>
      )}

      <div className="task-list">
        {tasks.length === 0 && (
          <p className="task-empty">
            No tasks yet. Pick a tool above — the operator handles it and the result lands here.
          </p>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="task-item">
            <div className="task-item-head">
              <strong>{TOOLS.find((x) => x.key === t.tool)?.name ?? t.tool}</strong>
              <span className={`status-chip ${t.status}`}>{STATUS_LABEL[t.status]}</span>
            </div>
            <p className="task-request">{t.request}</p>
            {t.result && <p className="task-result">{t.result}</p>}
          </div>
        ))}
      </div>
    </aside>
  );
}
