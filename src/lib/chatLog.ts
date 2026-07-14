/**
 * Chat logging — mirrors every conversation turn to Supabase so the founder
 * can review, from the dashboard, what each signed-in user asked for.
 *
 * Fire-and-forget by design: logging runs after the UI has already moved on,
 * silently no-ops when auth isn't configured or nobody is signed in, and
 * swallows every failure — a downed table must never break the conversation.
 */
import { supabase } from "./auth";

/** One id per page load, so a visit's messages group into a conversation. */
const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function logChat(role: "user" | "assistant", content: string): void {
  if (!supabase) return;
  const client = supabase;
  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      if (!user) return;
      await client.from("chat_messages").insert({
        user_id: user.id,
        user_email: user.email,
        session_id: sessionId,
        role,
        content,
      });
    } catch (err) {
      console.warn("[chat-log] failed to record message:", err);
    }
  })();
}
