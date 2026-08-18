import { resolveUserFull } from "./_audit";
import { emailDeliveryProviderKey, loadEmailDeliveryRow } from "./_emailDelivery";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection } from "./_shopify";
import { fetchLapsedCustomers } from "./_shopifyData";
import type { RecoveryCampaignEnv } from "./_recoveryCampaigns";

type Touch = { delayLabel: string; subject: string; body: string };
type Segment = "best" | "vip" | "repeat" | "recent" | "all";
type Campaign = { id: string; user_id: string; status: string; touches: Touch[]; segment: Segment };
type Delivery = { id: string; campaign_id: string; user_id: string; customer_id: string; touch_index: number; attempt_count: number };

const headers = (env: RecoveryCampaignEnv) => {
  const key = env.serviceRoleKey ?? "";
  return { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", "User-Agent": "EvolutionBackend/1.0" };
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const encoder = new TextEncoder();
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function signature(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
function same(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }

async function getCampaign(env: RecoveryCampaignEnv, id: string, userId: string) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}&select=id,user_id,status,touches,segment&limit=1`, { headers: headers(env) });
  return res.ok ? ((await res.json()) as Campaign[])[0] ?? null : null;
}

function audienceForSegment<T extends { totalSpent: number; ordersCount: number; lastOrderAt: string }>(customers: T[], segment: Segment) {
  if (segment === "all") return customers;
  if (segment === "repeat") return customers.filter((customer) => customer.ordersCount >= 2);
  if (segment === "recent") return customers.filter((customer) => Date.now() - Date.parse(customer.lastOrderAt) <= 120 * 86_400_000);
  const ranked = [...customers].sort((a, b) => b.totalSpent - a.totalSpent);
  if (segment === "vip") return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * .25)));
  const repeat = ranked.filter((customer) => customer.ordersCount >= 2);
  return (repeat.length ? repeat : ranked).slice(0, Math.max(1, Math.ceil(customers.length * .4)));
}

async function mark(env: RecoveryCampaignEnv, id: string, patch: Record<string, unknown>) {
  await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?id=eq.${id}`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
}

function render(touch: Touch, customer: { firstName: string; lastItems: { title: string; qty: number }[] }, storeName: string, storeUrl: string) {
  const items = customer.lastItems.map((item) => item.qty > 1 ? `${item.qty}x ${item.title}` : item.title).join(", ") || "your last order";
  const replace = (value: string) => value.replaceAll("{{first_name}}", customer.firstName || "there").replaceAll("{{items}}", items).replaceAll("{{store_name}}", storeName).replaceAll("{{store_url}}", storeUrl).replaceAll("{{review_link}}", storeUrl);
  return { subject: replace(touch.subject), text: replace(touch.body) };
}

export async function runWinbackCampaignAction(body: Record<string, unknown>, authHeader: string | null, env: RecoveryCampaignEnv): Promise<Response> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!(await isOperator(env, user.id, user.email))) return json(OPERATOR_REQUIRED.body, 402);
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "history") {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?user_id=eq.${user.id}&select=*,winback_deliveries(id,touch_index,due_at,status,delivery_status,error,sent_at,delivered_at,opened_at,clicked_at,bounced_at,complained_at,unsubscribed_at,resend_email_id)&order=created_at.desc&winback_deliveries.order=due_at.asc&limit=20`, { headers: headers(env) });
    return res.ok ? json({ campaigns: await res.json() }) : json({ error: "Could not load win-back campaigns." }, 502);
  }
  const id = typeof body.campaignId === "string" ? body.campaignId : "";
  const campaign = await getCampaign(env, id, user.id);
  if (!campaign) return json({ error: "Win-back campaign not found." }, 404);
  if (action === "reject" || action === "pause") {
    const status = action === "reject" ? "rejected" : "paused";
    await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?id=eq.${id}`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
    if (action === "reject") await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?campaign_id=eq.${id}&status=eq.queued`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }) });
    return json({ campaign: { ...campaign, status } });
  }
  if (action === "resume") {
    await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?id=eq.${id}`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ status: "scheduled", updated_at: new Date().toISOString() }) });
    return json({ campaign: { ...campaign, status: "scheduled" } });
  }
  if (action !== "approve") return json({ error: "Unsupported campaign action." }, 400);
  if (campaign.status !== "proposed") return json({ error: `Campaign is already ${campaign.status}.` }, 409);
  const settings = await loadEmailDeliveryRow(env, user.id);
  if (!settings || settings.status !== "ready") return json({ error: "Complete email delivery setup and send a successful test first." }, 409);
  const conn = await getConnection(env, user.id);
  if (!conn) return json({ error: "Reconnect Shopify first." }, 409);
  const live = await fetchLapsedCustomers(conn, { minDays: 60, maxDays: 365 });
  if (!Array.isArray(live)) return json({ error: "Could not refresh lapsed customers from Shopify." }, 502);
  const customers = audienceForSegment(live.filter((customer) => customer.email.includes("@")), campaign.segment || "all");
  if (!customers.length) return json({ error: "There are no eligible lapsed customers to schedule." }, 409);
  const now = Date.now();
  const deliveries = customers.flatMap((customer) => [0, 10 * 86_400_000].map((offset, touch_index) => ({ campaign_id: id, user_id: user.id, customer_id: customer.id, touch_index, due_at: new Date(now + offset).toISOString(), status: "queued" })));
  const inserted = await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?on_conflict=campaign_id,customer_id,touch_index`, { method: "POST", headers: { ...headers(env), Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(deliveries) });
  if (!inserted.ok) return json({ error: "Could not create the win-back schedule. Run the win-back migration." }, 502);
  const approvedAt = new Date().toISOString();
  await fetch(`${env.supabaseUrl}/rest/v1/winback_campaigns?id=eq.${id}`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ status: "scheduled", approved_at: approvedAt, customer_count: customers.length, updated_at: approvedAt }) });
  const result = await processWinbackDeliveries(env, user.id, 10);
  return json({ campaign: { ...campaign, status: "scheduled", approved_at: approvedAt }, scheduled: deliveries.length, sentNow: result.sent, skipped: result.skipped, failed: result.failed, testMode: Boolean(env.recoveryTestMode) });
}

export async function processWinbackDeliveries(env: RecoveryCampaignEnv, userFilter?: string, limit = 25) {
  const filter = `status=eq.queued&due_at=lte.${encodeURIComponent(new Date().toISOString())}${userFilter ? `&user_id=eq.${userFilter}` : ""}`;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?${filter}&select=id,campaign_id,user_id,customer_id,touch_index,attempt_count&order=due_at.asc&limit=${limit}`, { headers: headers(env) });
  const rows = res.ok ? await res.json() as Delivery[] : [];
  let sent = 0, skipped = 0, failed = 0;
  for (const delivery of rows) {
    const claim = await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?id=eq.${delivery.id}&status=eq.queued`, { method: "PATCH", headers: { ...headers(env), Prefer: "return=representation" }, body: JSON.stringify({ status: "processing", attempt_count: delivery.attempt_count + 1, updated_at: new Date().toISOString() }) });
    if (!claim.ok || ((await claim.json()) as unknown[]).length === 0) continue;
    const campaign = await getCampaign(env, delivery.campaign_id, delivery.user_id);
    if (!campaign || campaign.status !== "scheduled") { await mark(env, delivery.id, { status: "cancelled", error: "Campaign is not active." }); skipped++; continue; }
    const settings = await loadEmailDeliveryRow(env, delivery.user_id);
    const conn = await getConnection(env, delivery.user_id);
    if (!settings || settings.status !== "ready" || !conn) { await mark(env, delivery.id, { status: "failed", error: "Delivery identity or Shopify connection is unavailable." }); failed++; continue; }
    const live = await fetchLapsedCustomers(conn, { minDays: 60, maxDays: 365 });
    const eligible = Array.isArray(live) ? audienceForSegment(live.filter((item) => item.email.includes("@")), campaign.segment || "all") : [];
    const customer = eligible.find((item) => item.id === delivery.customer_id) ?? null;
    if (!customer) { await mark(env, delivery.id, { status: "skipped", error: "Customer purchased again, unsubscribed, or is no longer eligible." }); skipped++; continue; }
    const touch = campaign.touches[delivery.touch_index];
    const key = await emailDeliveryProviderKey(env, settings);
    if (!touch || !key) { await mark(env, delivery.id, { status: "failed", error: "Campaign copy or provider credential is unavailable." }); failed++; continue; }
    const storeName = conn.shop_domain.replace(/\.myshopify\.com$/i, "");
    const rendered = render(touch, customer, storeName, `https://${conn.shop_domain}`);
    const to = env.recoveryTestMode && env.recoveryTestRecipient ? env.recoveryTestRecipient : customer.email;
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const counts = await Promise.all(["recovery_deliveries", "winback_deliveries"].map((table) => fetch(`${env.supabaseUrl}/rest/v1/${table}?user_id=eq.${delivery.user_id}&status=eq.sent&sent_at=gte.${encodeURIComponent(monthStart.toISOString())}&select=id`, { method: "HEAD", headers: { ...headers(env), Prefer: "count=exact" } })));
    const used = counts.reduce((sum, count) => sum + Number(count.headers.get("content-range")?.split("/")[1] ?? 0), 0);
    if (used >= (env.monthlyEmailLimit ?? 400)) { await mark(env, delivery.id, { status: "failed", error: "Monthly email limit reached." }); failed++; continue; }
    if (!env.encryptionKey) { await mark(env, delivery.id, { status: "failed", error: "Unsubscribe signing is not configured." }); failed++; continue; }
    const sig = await signature(env.encryptionKey, delivery.id);
    const unsubscribe = `${env.publicOrigin ?? "https://www.runevolution.io"}/api/winback-unsubscribe?id=${encodeURIComponent(delivery.id)}&sig=${encodeURIComponent(sig)}`;
    const text = `${rendered.text}\n\nStop win-back emails: ${unsubscribe}`;
    const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `winback/${delivery.id}` }, body: JSON.stringify({ from: `${settings.sender_name} <${settings.sender_email}>`, to: [to], reply_to: settings.reply_to, subject: env.recoveryTestMode ? `[TEST for ${customer.email}] ${rendered.subject}` : rendered.subject, text, headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }) });
    const result = await send.json().catch(() => ({})) as { id?: string; message?: string };
    if (send.ok && result.id) { await mark(env, delivery.id, { status: "sent", resend_email_id: result.id, sent_at: new Date().toISOString(), error: null }); sent++; }
    else { await mark(env, delivery.id, { status: "failed", error: result.message ?? `Resend failed (${send.status}).` }); failed++; }
  }
  return { processed: rows.length, sent, skipped, failed };
}

export async function runWinbackUnsubscribe(req: Request, env: RecoveryCampaignEnv) {
  const url = new URL(req.url); const id = url.searchParams.get("id") ?? ""; const sig = url.searchParams.get("sig") ?? "";
  if (!id || !sig || !env.encryptionKey || !same(sig, await signature(env.encryptionKey, id))) return new Response("Invalid or expired unsubscribe link.", { status: 400 });
  const found = await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?id=eq.${encodeURIComponent(id)}&select=user_id,customer_id&limit=1`, { headers: headers(env) });
  const row = found.ok ? ((await found.json()) as { user_id: string; customer_id: string }[])[0] : null;
  if (!row) return new Response("This win-back sequence is already inactive.", { status: 200 });
  const now = new Date().toISOString();
  await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?user_id=eq.${row.user_id}&customer_id=eq.${encodeURIComponent(row.customer_id)}&status=eq.queued`, { method: "PATCH", headers: headers(env), body: JSON.stringify({ status: "cancelled", delivery_status: "unsubscribed", unsubscribed_at: now, error: "Customer unsubscribed from win-back emails.", updated_at: now }) });
  return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Unsubscribed</title><body style='font-family:system-ui;max-width:560px;margin:80px auto;padding:24px'><h1>Win-back emails stopped</h1><p>You will not receive the remaining emails in this sequence.</p></body>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
