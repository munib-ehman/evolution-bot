/**
 * POST /api/retention-draft — drafts the owner's retention email templates
 * (2 win-back touches + 1 review request; subjects + plain-text bodies with
 * placeholders). Built from NON-PII store facts; ships hand-written defaults
 * when the LLM is unavailable. Requires the Supabase bearer. Logic lives in
 * _retention.ts.
 */
import { runRetentionDraft } from "./_retention";
import { shopifyEnvFromProcess } from "./_shopify";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body: { note?: unknown } = {};
  try {
    body = (await req.json()) as { note?: unknown };
  } catch {
    /* empty body is fine */
  }
  const { status, body: result } = await runRetentionDraft(
    body,
    req.headers.get("authorization"),
    shopifyEnvFromProcess(),
  );
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
