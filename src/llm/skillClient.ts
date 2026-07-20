/**
 * Client for POST /api/skill — the authenticated agentic skill runs.
 *
 * Separate from client.ts on purpose: that file's exact behavior is
 * load-bearing for the voice loop, and this stream carries extra event
 * shapes ({"progress"}, {"meta"}, {"error"}) alongside the OpenAI-style
 * deltas. See api/_skills.ts for the protocol.
 */
import { supabase } from "../lib/auth";

export class SkillError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SkillRunResult {
  report: string;
  taskId?: string;
  emailed?: boolean;
}

export interface SkillRunOptions {
  note?: string;
  taskTool?: string;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
  onToken?: (text: string) => void;
}

export async function runSkill(skillId: string, opts: SkillRunOptions = {}): Promise<SkillRunResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (!headers.Authorization) throw new SkillError(401, "Sign in to run skills.");

  const res = await fetch("/api/skill", {
    method: "POST",
    headers,
    body: JSON.stringify({ skillId, note: opts.note, taskTool: opts.taskTool }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let message = `Skill run failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep the generic message */
    }
    throw new SkillError(res.status, message);
  }
  if (!res.body) throw new SkillError(500, "The skill stream had no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report = "";
  let taskId: string | undefined;
  let emailed: boolean | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (!report) throw new SkillError(500, "The skill returned an empty report.");
          return { report, taskId, emailed };
        }
        let json: {
          progress?: string;
          error?: string;
          meta?: { taskId?: string; emailed?: boolean };
          choices?: { delta?: { content?: string } }[];
        };
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // keep-alives / malformed lines
        }
        if (typeof json.error === "string") throw new SkillError(500, json.error);
        if (typeof json.progress === "string") opts.onProgress?.(json.progress);
        if (json.meta) {
          taskId = json.meta.taskId ?? taskId;
          emailed = json.meta.emailed ?? emailed;
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          report += delta;
          opts.onToken?.(delta);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!report) throw new SkillError(500, "The skill stream ended unexpectedly.");
  return { report, taskId, emailed };
}
