/**
 * The ops queue — owners file task requests (one per vertical), the team
 * fulfills them concierge-style, and results flow back into the app.
 * Same tolerant style as chatLog.ts / store.ts: null/no-op on any failure.
 */
import { supabase } from "./auth";

export type TaskStatus = "new" | "in_progress" | "done";

export interface OpsTask {
  id: string;
  user_id: string;
  tool: string;
  request: string;
  status: TaskStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
}

/** The 6 verticals from the MVP guide, presented as what the operator handles. */
export const TOOLS: { key: string; name: string; blurb: string; starter: string }[] = [
  {
    key: "product",
    name: "Product research",
    blurb: "Find and source winning products for your niche.",
    starter: "Find me a winning product to add to my store, with suppliers and rough prices.",
  },
  {
    key: "marketing",
    name: "Cart recovery",
    blurb: "Win back the shoppers who abandoned checkout.",
    starter: "Set up a 3-touch email/SMS sequence to recover my abandoned carts.",
  },
  {
    key: "support",
    name: "Customer support",
    blurb: "Answer customer questions 24/7 from your store's info.",
    starter: "Set up 24/7 support that answers questions about my products, shipping, and returns.",
  },
  {
    key: "retention",
    name: "Retention & reviews",
    blurb: "Bring back past customers and collect reviews.",
    starter: "Email my past customers to win them back, and request reviews from recent buyers.",
  },
  {
    key: "operations",
    name: "Back in stock",
    blurb: "Stop losing sales to stockouts.",
    starter: "Add back-in-stock capture to my sold-out products and alert me when to restock.",
  },
  {
    key: "analytics",
    name: "True profit",
    blurb: "Real profit per order, after ads and fees.",
    starter: "Show me my true profit per order after ads and fees, plus CAC and LTV.",
  },
];

export async function createTask(tool: string, request: string, storeId?: string | null): Promise<OpsTask | null> {
  if (!supabase) return null;
  try {
    const { data: session } = await supabase.auth.getSession();
    const user = session.session?.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: user.id, store_id: storeId ?? null, tool, request })
      .select()
      .single();
    if (error) return null;
    return data as OpsTask;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget team notification for a just-filed task. The server
 * re-reads the task (scoped to the caller) and emails the founders when
 * Resend is configured; without it this is a harmless 204. Never throws.
 */
export async function notifyTeam(taskId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/task-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    /* best-effort */
  }
}

/** The signed-in owner's tasks, newest first (RLS scopes to own rows). */
export async function listTasks(): Promise<OpsTask[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from("tasks")
      .select()
      .order("created_at", { ascending: false });
    return (data as OpsTask[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Admin: every task in the queue (needs the admin RLS policies). */
export async function listAllTasks(): Promise<OpsTask[]> {
  return listTasks(); // same query — RLS decides how much it returns
}

/** Admin: look up owner emails + store URLs to label queue rows. */
export async function adminContext(): Promise<{
  emails: Map<string, string>;
  stores: Map<string, string>;
}> {
  const emails = new Map<string, string>();
  const stores = new Map<string, string>();
  if (!supabase) return { emails, stores };
  try {
    const [profiles, storeRows] = await Promise.all([
      supabase.from("profiles").select("user_id, email"),
      supabase.from("stores").select("user_id, url"),
    ]);
    for (const p of profiles.data ?? []) emails.set(p.user_id as string, (p.email as string) ?? "");
    for (const s of storeRows.data ?? []) stores.set(s.user_id as string, (s.url as string) ?? "");
  } catch {
    /* labels are nice-to-have */
  }
  return { emails, stores };
}

/** Admin: move a task through the queue and attach the result. */
export async function updateTask(id: string, status: TaskStatus, result: string | null): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from("tasks")
      .update({ status, result, updated_at: new Date().toISOString() })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
