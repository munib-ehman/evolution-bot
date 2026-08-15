import { resolveUserFull } from "./_audit";
import { emailDeliveryProviderKey, loadEmailDeliveryRow } from "./_emailDelivery";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection } from "./_shopify";
import { fetchSupportRiskOrders, type SupportRiskOrder } from "./_shopifyData";
import type { RecoveryCampaignEnv } from "./_recoveryCampaigns";

type Resolution = "investigating" | "ship_date" | "cancel_refund" | "custom";
type NotificationRow = {
  id: string; user_id: string; order_id: string; order_name: string; status: "proposed" | "sent" | "resolved" | "failed";
  resolution: Resolution; subject: string; body: string; resend_email_id?: string | null; delivery_status?: string | null;
  approved_at?: string | null; sent_at?: string | null; resolved_at?: string | null; error?: string | null; created_at: string; updated_at: string;
};

const svcHeaders = (env: RecoveryCampaignEnv): Record<string, string> => {
  const key = env.serviceRoleKey ?? "";
  return { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", "User-Agent": "EvolutionBackend/1.0" };
};
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const validResolution = (value: unknown): value is Resolution => ["investigating", "ship_date", "cancel_refund", "custom"].includes(String(value));
const itemLabel = (order: SupportRiskOrder) => order.items.map((item) => item.qty > 1 ? `${item.qty}× ${item.title}` : item.title).join(", ") || "your order";

export function buildSupportDraft(order: Pick<SupportRiskOrder, "name" | "items">, resolution: Resolution, detail = "") {
  const subject = `An update on order ${order.name}`;
  const intro = `Hi {{first_name}},\n\nI’m sorry your order ${order.name} has taken longer than expected.`;
  const product = itemLabel(order as SupportRiskOrder);
  if (resolution === "ship_date") {
    return { subject, body: `${intro} We have confirmed that ${product} is expected to ship ${detail || "on the confirmed date"}. If you would prefer not to wait, reply to this email and we can discuss cancellation or a refund.\n\n— {{store_name}}` };
  }
  if (resolution === "cancel_refund") {
    return { subject, body: `${intro} We don’t have a reliable shipping date yet. If you would prefer not to wait, reply to this email and we can help with cancellation or a refund.\n\n— {{store_name}}` };
  }
  if (resolution === "custom" && detail) {
    return { subject, body: `${intro} ${detail}\n\nIf you have any questions, reply to this email and we’ll help.\n\n— {{store_name}}` };
  }
  return { subject, body: `${intro} We’re checking its fulfillment status now and will only provide a shipping estimate once it has been confirmed. If you would prefer not to wait, reply to this email and we can discuss cancellation or a refund.\n\n— {{store_name}}` };
}

async function authenticate(authHeader: string | null, env: RecoveryCampaignEnv) {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { response: json({ error: "Sign in first." }, 401) };
  if (!(await isOperator(env, user.id, user.email))) return { response: json(OPERATOR_REQUIRED.body, OPERATOR_REQUIRED.status) };
  const conn = await getConnection(env, user.id);
  if (!conn) return { response: json({ error: "Connect your Shopify store first." }, 409) };
  return { user, conn };
}

async function liveRisks(env: RecoveryCampaignEnv, conn: NonNullable<Awaited<ReturnType<typeof getConnection>>>) {
  const risks = await fetchSupportRiskOrders(conn);
  if (risks === "access-denied") return { response: json({ error: "Shopify protected customer-data access is required for support emails." }, 403) };
  if (!risks) return { response: json({ error: "Could not load the Shopify support queue." }, 502) };
  return { risks: risks.filter((order) => Date.now() - Date.parse(order.createdAt) >= 48 * 3_600_000) };
}

async function notificationRows(env: RecoveryCampaignEnv, userId: string): Promise<NotificationRow[] | null> {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?user_id=eq.${userId}&select=*&order=created_at.desc`, { headers: svcHeaders(env) });
  return response.ok ? response.json() as Promise<NotificationRow[]> : null;
}

export async function runSupportCasesGet(authHeader: string | null, env: RecoveryCampaignEnv): Promise<Response> {
  const checked = await authenticate(authHeader, env); if ("response" in checked) return checked.response!;
  const live = await liveRisks(env, checked.conn); if ("response" in live) return live.response!;
  const rows = await notificationRows(env, checked.user.id);
  if (!rows) return json({ error: "Support notification storage is not ready. Run the support notifications migration." }, 503);
  const latest = new Map<string, NotificationRow>();
  for (const row of rows) if (!latest.has(row.order_id)) latest.set(row.order_id, row);
  return json({ cases: live.risks.map((order) => ({ ...order, notification: latest.get(order.id) ?? null })) });
}

export async function runSupportCasesAction(body: Record<string, unknown>, authHeader: string | null, env: RecoveryCampaignEnv): Promise<Response> {
  const checked = await authenticate(authHeader, env); if ("response" in checked) return checked.response!;
  const action = clean(body.action, 30);
  const live = await liveRisks(env, checked.conn); if ("response" in live) return live.response!;
  const orderId = clean(body.orderId, 180);
  const order = live.risks.find((candidate) => candidate.id === orderId);

  if (action === "draft") {
    if (!order) return json({ error: "This order is no longer an unresolved fulfillment risk." }, 409);
    if (!order.email.includes("@")) return json({ error: "This order has no customer email address." }, 409);
    if (!validResolution(body.resolution)) return json({ error: "Choose a verified resolution before drafting." }, 400);
    const detail = clean(body.detail, 700);
    if ((body.resolution === "ship_date" || body.resolution === "custom") && !detail) return json({ error: "Add the confirmed ship date or custom resolution details." }, 400);
    const draft = buildSupportDraft(order, body.resolution, detail);
    const now = new Date().toISOString();
    const existing = (await notificationRows(env, checked.user.id))?.find((row) => row.order_id === order.id);
    if (existing?.status === "sent") return json({ error: `A support email for ${order.name} was already sent. Duplicate sending is blocked.` }, 409);
    const saved = await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?on_conflict=user_id,order_id`, {
      method: "POST", headers: { ...svcHeaders(env), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: checked.user.id, order_id: order.id, order_name: order.name, status: "proposed", resolution: body.resolution, subject: draft.subject, body: draft.body, resend_email_id: null, delivery_status: null, approved_at: null, sent_at: null, resolved_at: null, error: null, updated_at: now }),
    });
    if (!saved.ok) return json({ error: "Could not save the support draft. Run the support notifications migration first." }, 503);
    return json({ notification: ((await saved.json()) as NotificationRow[])[0] });
  }

  const rows = await notificationRows(env, checked.user.id);
  const notification = rows?.find((row) => row.order_id === orderId);
  if (!notification) return json({ error: "Generate and review a support email first." }, 409);

  if (action === "resolve") {
    const now = new Date().toISOString();
    await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?id=eq.${notification.id}`, { method: "PATCH", headers: svcHeaders(env), body: JSON.stringify({ status: "resolved", resolved_at: now, updated_at: now }) });
    return json({ notification: { ...notification, status: "resolved", resolved_at: now } });
  }

  if (action !== "send") return json({ error: "Unsupported support action." }, 400);
  if (body.approved !== true) return json({ error: "Review and explicitly approve the email before sending." }, 400);
  if (notification.status === "sent") return json({ error: `A support email for ${notification.order_name} was already sent. Duplicate sending is blocked.` }, 409);
  if (!order || !order.email.includes("@")) return json({ error: "The order is no longer contactable or no longer needs fulfillment support." }, 409);
  const subject = clean(body.subject, 160); const approvedBody = clean(body.body, 4000);
  if (!subject || !approvedBody) return json({ error: "The approved subject and message are required." }, 400);
  const settings = await loadEmailDeliveryRow(env, checked.user.id);
  if (!settings || settings.status !== "ready") return json({ error: "Complete Email setup and send a successful test first." }, 409);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const usage = await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?user_id=eq.${checked.user.id}&status=eq.sent&sent_at=gte.${encodeURIComponent(monthStart.toISOString())}&select=id`, { method: "HEAD", headers: { ...svcHeaders(env), Prefer: "count=exact" } });
  const sentThisMonth = Number(usage.headers.get("content-range")?.split("/")[1] ?? 0);
  if (sentThisMonth >= (env.monthlyEmailLimit ?? 400)) return json({ error: "Monthly email limit reached." }, 409);
  const key = await emailDeliveryProviderKey(env, settings);
  if (!key) return json({ error: "Email provider credentials are unavailable." }, 409);
  const firstName = order.firstName || "there"; const storeName = settings.sender_name || checked.conn.shop_domain.replace(/\.myshopify\.com$/i, "");
  const rendered = approvedBody.replaceAll("{{first_name}}", firstName).replaceAll("{{store_name}}", storeName);
  const to = env.recoveryTestMode && env.recoveryTestRecipient ? env.recoveryTestRecipient : order.email;
  const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `support/${notification.id}` }, body: JSON.stringify({ from: `${settings.sender_name} <${settings.sender_email}>`, to: [to], reply_to: settings.reply_to, subject: env.recoveryTestMode ? `[TEST for ${order.email}] ${subject}` : subject, text: rendered }) });
  const result = await send.json().catch(() => ({})) as { id?: string; message?: string };
  const now = new Date().toISOString();
  if (!send.ok || !result.id) {
    await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?id=eq.${notification.id}`, { method: "PATCH", headers: svcHeaders(env), body: JSON.stringify({ status: "failed", error: result.message ?? `Resend failed (${send.status}).`, updated_at: now }) });
    return json({ error: result.message ?? "The email provider rejected the support message." }, 502);
  }
  const patch = { status: "sent", subject, body: approvedBody, resend_email_id: result.id, delivery_status: "accepted", approved_at: now, sent_at: now, error: null, updated_at: now };
  await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?id=eq.${notification.id}`, { method: "PATCH", headers: svcHeaders(env), body: JSON.stringify(patch) });
  return json({ notification: { ...notification, ...patch }, testMode: Boolean(env.recoveryTestMode) });
}
