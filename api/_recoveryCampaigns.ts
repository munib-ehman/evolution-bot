import { resolveUserFull } from "./_audit";
import { getConnection, type ShopifyEnv } from "./_shopify";
import { fetchRecoverableCheckouts, type RecoverableCart } from "./_shopifyData";
import { emailDeliveryProviderKey, loadEmailDeliveryRow, type EmailDeliveryEnv } from "./_emailDelivery";
import { hasRole, roleRequired } from "./_plan";
import { log } from "./_log";
import { DEFAULT_TOUCHES } from "./_recovery";
import { finalizeContact, reserveContact, suppressContact, suppressDeliveryContact } from "./_marketingSafety";
import { canonicalActivityId, recordCanonicalProposal, updateCanonicalActivityStatus, validateCanonicalApproval, writeIntelligentCopy } from "./_marketingIntelligence";
import { recordMarketingDeliveryEvent } from "./_marketingAttribution";
import { autopilotAllowance } from "./_autonomy";

export interface RecoveryCampaignEnv extends EmailDeliveryEnv, ShopifyEnv {
  cronSecret?: string;
  recoveryTestMode?: boolean;
  recoveryTestRecipient?: string;
  monthlyEmailLimit?: number;
  publicOrigin?: string;
  resendWebhookSecret?: string;
}
type Touch = { delayLabel: string; subject: string; body: string };
type Campaign = { id: string; user_id: string; status: string; touches: Touch[]; approved_at?: string | null; currency?: string | null };
type Delivery = { id: string; campaign_id: string; user_id: string; checkout_id: string; touch_index: number; attempt_count: number };

const h = (env: RecoveryCampaignEnv): Record<string, string> => {
  const key = env.serviceRoleKey ?? "";
  return { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", "User-Agent": "EvolutionBackend/1.0" };
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const enc = new TextEncoder();
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signValue(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}

async function signedUnsubscribeUrl(env: RecoveryCampaignEnv, deliveryId: string) {
  const sig = await signValue(env.encryptionKey ?? "", deliveryId);
  return `${env.publicOrigin ?? "https://www.runevolution.io"}/api/recovery-unsubscribe?id=${encodeURIComponent(deliveryId)}&sig=${encodeURIComponent(sig)}`;
}

function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function merchant(env: RecoveryCampaignEnv, authHeader: string | null) {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { response: json({ error: "Sign in first." }, 401) };
  if (!(await hasRole(env, user.id, "marketing", user.email))) { const denied=roleRequired("marketing"); return { response: json(denied.body, denied.status) }; }
  return { user };
}

function render(touch: Touch, cart: RecoverableCart, storeName: string, currency: string | null) {
  const items = cart.items.map((i) => i.qty > 1 ? `${i.qty}× ${i.title}` : i.title).join(", ") || "your items";
  let total = `$${Math.round(cart.totalPrice)}`;
  try { total = new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(cart.totalPrice); } catch { /* fallback */ }
  const sub = (s: string) => s.replaceAll("{{first_name}}", cart.firstName || "there").replaceAll("{{items}}", items).replaceAll("{{total}}", total).replaceAll("{{checkout_url}}", cart.recoveryUrl).replaceAll("{{store_name}}", storeName);
  return { subject: sub(touch.subject), text: sub(touch.body) };
}

async function campaign(env: RecoveryCampaignEnv, id: string, userId: string): Promise<Campaign | null> {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}&select=id,user_id,status,touches,approved_at,currency&limit=1`, { headers: h(env) });
  return res.ok ? ((await res.json()) as Campaign[])[0] ?? null : null;
}

export async function runRecoveryCampaignAction(body: Record<string, unknown>, authHeader: string | null, env: RecoveryCampaignEnv): Promise<Response> {
  const checked = await merchant(env, authHeader); if ("response" in checked) return checked.response!;
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "observe") {
    const conn = await getConnection(env, checked.user.id);
    if (!conn) return json({ error: "Reconnect Shopify first." }, 409);
    return json(await detectRecoveryOpportunities(env, [{ user_id: checked.user.id, shop_domain: conn.shop_domain }]));
  }
  if (action === "history") {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?user_id=eq.${checked.user.id}&select=*,recovery_deliveries(id,touch_index,due_at,status,delivery_status,error,sent_at,delivered_at,opened_at,clicked_at,bounced_at,complained_at,unsubscribed_at,resend_email_id)&order=created_at.desc&recovery_deliveries.order=due_at.asc&limit=20`, { headers: h(env) });
    return res.ok ? json({ campaigns: await res.json() }) : json({ error: "Could not load campaigns." }, 502);
  }
  const id = typeof body.campaignId === "string" ? body.campaignId : "";
  const row = await campaign(env, id, checked.user.id);
  if (!row) return json({ error: "Campaign not found." }, 404);
  if (action === "reject" || action === "pause") {
    const next = action === "reject" ? "rejected" : "paused";
    await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?id=eq.${id}&user_id=eq.${checked.user.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: next, updated_at: new Date().toISOString() }) });
    await updateCanonicalActivityStatus(env,"recovery_campaigns",id,next);
    await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?campaign_id=eq.${id}&status=eq.queued`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: action === "reject" ? "cancelled" : "queued", updated_at: new Date().toISOString() }) });
    return json({ campaign: { ...row, status: next } });
  }
  if (action === "resume") {
    await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?id=eq.${id}&user_id=eq.${checked.user.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: "scheduled", updated_at: new Date().toISOString() }) });
    await updateCanonicalActivityStatus(env,"recovery_campaigns",id,"scheduled");
    return json({ campaign: { ...row, status: "scheduled" } });
  }
  if (action !== "approve") return json({ error: "Unsupported campaign action." }, 400);
  if (row.status !== "proposed") return json({ error: `Campaign is already ${row.status}.` }, 409);
  const validation=await validateCanonicalApproval(env,checked.user.id,"recovery_campaigns",id);if(!validation.allowed)return json({error:validation.error},409);
  const settings = await loadEmailDeliveryRow(env, checked.user.id);
  if (!settings || settings.status !== "ready") return json({ error: "Complete email delivery setup and send a successful test first." }, 409);
  const conn = await getConnection(env, checked.user.id); if (!conn) return json({ error: "Reconnect Shopify first." }, 409);
  const live = await fetchRecoverableCheckouts(conn, 30);
  if (!Array.isArray(live)) return json({ error: "Could not refresh abandoned carts from Shopify." }, 502);
  const carts = live.filter((c) => c.email.includes("@") && c.recoveryUrl);
  if (!carts.length) return json({ error: "There are no longer any recoverable carts to schedule." }, 409);
  const now = Date.now();
  const offsets = [0, 2 * 86_400_000, 4 * 86_400_000];
  const deliveries = carts.flatMap((cart) => offsets.map((offset, touch_index) => ({ campaign_id: id, user_id: checked.user.id, checkout_id: cart.id, touch_index, due_at: new Date(now + offset).toISOString(), status: "queued" })));
  const inserted = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?on_conflict=campaign_id,checkout_id,touch_index`, { method: "POST", headers: { ...h(env), Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(deliveries) });
  if (!inserted.ok) return json({ error: "Could not create the delivery schedule. Run the recovery delivery migration." }, 502);
  const approvedAt = new Date().toISOString();
  await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?id=eq.${id}&user_id=eq.${checked.user.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: "scheduled", approved_at: approvedAt, cart_count: carts.length, updated_at: approvedAt }) });
  await updateCanonicalActivityStatus(env,"recovery_campaigns",id,"scheduled",{approved_at:approvedAt});
  const run = await processRecoveryDeliveries(env, checked.user.id, 10);
  return json({ campaign: { ...row, status: "scheduled", approved_at: approvedAt }, scheduled: deliveries.length, sentNow: run.sent, skipped: run.skipped, failed: run.failed, testMode: Boolean(env.recoveryTestMode) });
}

async function mark(env: RecoveryCampaignEnv, id: string, patch: Record<string, unknown>) {
  await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?id=eq.${id}`, { method: "PATCH", headers: h(env), body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
}

async function retryOrFail(env: RecoveryCampaignEnv, delivery: Delivery, message: string) {
  const attempt = delivery.attempt_count + 1;
  if (attempt < 3) {
    await mark(env, delivery.id, { status: "queued", due_at: new Date(Date.now() + attempt * 10 * 60_000).toISOString(), error: `${message} Retrying automatically.` });
  } else {
    await mark(env, delivery.id, { status: "failed", error: message });
  }
}

async function enrollNewRecoverableCarts(env: RecoveryCampaignEnv, userFilter?: string) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?status=eq.scheduled${userFilter ? `&user_id=eq.${userFilter}` : ""}&select=id,user_id,status,touches,approved_at,currency&limit=100`, { headers: h(env) });
  const campaigns = res.ok ? await res.json() as Campaign[] : [];
  let enrolled = 0;
  for (const active of campaigns) {
    const conn = await getConnection(env, active.user_id);
    const live = conn ? await fetchRecoverableCheckouts(conn, 30) : null;
    if (!Array.isArray(live)) continue;
    const existingRes = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?campaign_id=eq.${active.id}&select=checkout_id`, { headers: h(env) });
    const existing = new Set(existingRes.ok ? (await existingRes.json() as { checkout_id: string }[]).map((row) => row.checkout_id) : []);
    const approvedMs = active.approved_at ? Date.parse(active.approved_at) : Date.now();
    const offsets = [60 * 60_000, 2 * 86_400_000, 4 * 86_400_000];
    const eligible = live.filter((cart) => !existing.has(cart.id) && cart.email.includes("@") && cart.recoveryUrl && Date.parse(cart.createdAt) >= approvedMs);
    const inserts = eligible.flatMap((cart) => offsets.map((offset, touch_index) => ({ campaign_id: active.id, user_id: active.user_id, checkout_id: cart.id, touch_index, due_at: new Date(Date.parse(cart.createdAt) + offset).toISOString(), status: "queued" })));
    if (inserts.length) {
      const inserted = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?on_conflict=campaign_id,checkout_id,touch_index`, { method: "POST", headers: { ...h(env), Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(inserts) });
      if (inserted.ok) enrolled += eligible.length;
    }
  }
  return enrolled;
}

export async function processRecoveryDeliveries(env: RecoveryCampaignEnv, userFilter?: string, limit = 25) {
  const enrolled = await enrollNewRecoverableCarts(env, userFilter);
  const filter = `status=eq.queued&due_at=lte.${encodeURIComponent(new Date().toISOString())}${userFilter ? `&user_id=eq.${userFilter}` : ""}`;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?${filter}&select=id,campaign_id,user_id,checkout_id,touch_index,attempt_count&order=due_at.asc&limit=${limit}`, { headers: h(env) });
  const rows = res.ok ? await res.json() as Delivery[] : [];
  let sent = 0, skipped = 0, failed = 0;
  for (const delivery of rows) {
    const claim = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?id=eq.${delivery.id}&status=eq.queued`, { method: "PATCH", headers: { ...h(env), Prefer: "return=representation" }, body: JSON.stringify({ status: "processing", attempt_count: delivery.attempt_count + 1, updated_at: new Date().toISOString() }) });
    if (!claim.ok || ((await claim.json()) as unknown[]).length === 0) continue;
    const camp = await campaign(env, delivery.campaign_id, delivery.user_id);
    if (!camp || camp.status !== "scheduled") { await mark(env, delivery.id, { status: "cancelled", error: "Campaign is not active." }); skipped++; continue; }
    const settings = await loadEmailDeliveryRow(env, delivery.user_id);
    if (!settings || settings.status !== "ready") { await retryOrFail(env, delivery, "Delivery identity is not ready."); failed++; continue; }
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const countRes = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?user_id=eq.${delivery.user_id}&status=eq.sent&sent_at=gte.${encodeURIComponent(monthStart.toISOString())}&select=id`, { method: "HEAD", headers: { ...h(env), Prefer: "count=exact" } });
    const used = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
    if (used >= (env.monthlyEmailLimit ?? 400)) { await mark(env, delivery.id, { status: "failed", error: "Monthly email limit reached." }); failed++; continue; }
    const conn = await getConnection(env, delivery.user_id);
    const live = conn ? await fetchRecoverableCheckouts(conn, 30) : null;
    if (!Array.isArray(live)) { await retryOrFail(env, delivery, "Shopify could not be reached to verify the checkout."); failed++; continue; }
    const cart = live.find((c) => c.id === delivery.checkout_id && c.email.includes("@") && c.recoveryUrl);
    if (!cart) { await mark(env, delivery.id, { status: "skipped", error: "Checkout recovered, expired, or is no longer contactable." }); skipped++; continue; }
    const touch = camp.touches[delivery.touch_index];
    if (!touch) { await mark(env, delivery.id, { status: "failed", error: "Campaign touch is missing." }); failed++; continue; }
    const key = await emailDeliveryProviderKey(env, settings);
    if (!key) { await retryOrFail(env, delivery, "Email provider credential unavailable."); failed++; continue; }
    const store = conn!.shop_domain.replace(/\.myshopify\.com$/i, "");
    const rendered = render(touch, cart, store, camp.currency ?? null);
    const to = env.recoveryTestMode && env.recoveryTestRecipient ? env.recoveryTestRecipient : cart.email;
    const activityId=await canonicalActivityId(env,"recovery_campaigns",delivery.campaign_id);
    const reservation = await reserveContact(env, { userId: delivery.user_id, email: cart.email, kind: "recovery",activityId });
    if (!reservation.allowed) {
      if (reservation.reason === "quiet_hours" || reservation.reason === "safety_check_failed") await mark(env, delivery.id, { status: "queued", due_at: new Date(Date.now() + 60 * 60_000).toISOString(), error: `Deferred by contact policy: ${reservation.reason}.` });
      else await mark(env, delivery.id, { status: "skipped", error: `Stopped by contact policy: ${reservation.reason}.` });
      skipped++; continue;
    }
    const unsubscribe = await signedUnsubscribeUrl(env, delivery.id);
    const textBody = `${rendered.text}\n\nStop these recovery reminders: ${unsubscribe}`;
    const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `recovery/${delivery.id}` }, body: JSON.stringify({ from: `${settings.sender_name} <${settings.sender_email}>`, to: [to], reply_to: settings.reply_to, subject: env.recoveryTestMode ? `[TEST for ${cart.email}] ${rendered.subject}` : rendered.subject, text: textBody, headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }) });
    const result = await send.json().catch(() => ({})) as { id?: string; message?: string };
    if (send.ok && result.id) { await mark(env, delivery.id, { status: "sent", resend_email_id: result.id, sent_at: new Date().toISOString(), error: null }); await finalizeContact(env,reservation.reservationId,"sent",{deliveryId:delivery.id}); sent++; }
    else { await finalizeContact(env,reservation.reservationId,"skipped",{reason:"provider_failure"}); await retryOrFail(env, delivery, result.message ?? `Resend failed (${send.status}).`); failed++; }
  }
  log("info", "recovery-delivery", "run", { rows: rows.length, enrolled, sent, skipped, failed, testMode: Boolean(env.recoveryTestMode) });
  return { processed: rows.length, enrolled, sent, skipped, failed };
}

export async function runRecoveryCron(req: Request, env: RecoveryCampaignEnv): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) return json({ error: "Unauthorized." }, 401);
  return json(await processRecoveryDeliveries(env));
}

/** Inspect connected stores and prepare approval-only recovery proposals. */
export async function detectRecoveryOpportunities(env: RecoveryCampaignEnv, targetShops?: { user_id: string; shop_domain: string }[]) {
  if (!env.supabaseUrl || !env.serviceRoleKey) return { shops: 0, proposed: 0, skipped: 0, errors: 1 };
  let shops = targetShops;
  if (!shops) {
    const connections = await fetch(`${env.supabaseUrl}/rest/v1/shopify_connections?access_token=not.is.null&select=user_id,shop_domain&limit=200`, { headers: h(env) });
    if (!connections.ok) return { shops: 0, proposed: 0, skipped: 0, errors: 1 };
    shops = await connections.json() as { user_id: string; shop_domain: string }[];
  }
  let proposed = 0, skipped = 0, errors = 0;
  for (const shop of shops) {
    try {
      const activeResponse = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?user_id=eq.${shop.user_id}&status=in.(proposed,scheduled,paused)&select=id,status&order=created_at.desc&limit=1`, { headers: h(env) });
      const active = activeResponse.ok ? (await activeResponse.json() as { id: string; status: string }[])[0] : null;
      if (active && active.status !== "proposed") { skipped++; continue; }
      const conn = await getConnection(env, shop.user_id);
      const live = conn ? await fetchRecoverableCheckouts(conn, 30) : null;
      if (!Array.isArray(live)) { errors++; continue; }
      const carts = live.filter((cart) => cart.email.includes("@") && cart.recoveryUrl);
      if (active?.status === "proposed") {
        const now = new Date().toISOString();
        const totalValue = carts.reduce((sum, cart) => sum + (Number(cart.totalPrice) || 0), 0);
        await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?id=eq.${active.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify(carts.length ? { cart_count: carts.length, total_value: totalValue, updated_at: now } : { status: "completed", completed_at: now, updated_at: now }) });
        skipped++; continue;
      }
      if ((await autopilotAllowance(env,shop.user_id)).remaining<1) { skipped++; continue; }
      if (!carts.length) { skipped++; continue; }
      const cooldown = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const recent = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?user_id=eq.${shop.user_id}&status=eq.rejected&created_at=gte.${encodeURIComponent(cooldown)}&select=id&limit=1`, { headers: h(env) });
      if (recent.ok && (await recent.json() as unknown[]).length) { skipped++; continue; }
      const sequenceResponse = await fetch(`${env.supabaseUrl}/rest/v1/recovery_sequences?user_id=eq.${shop.user_id}&select=touches&limit=1`, { headers: h(env) });
      const saved = sequenceResponse.ok ? (await sequenceResponse.json() as { touches?: Touch[] }[])[0]?.touches : null;
      const totalValue = carts.reduce((sum, cart) => sum + (Number(cart.totalPrice) || 0), 0);
      const evidence={cartCount:carts.length,totalValue,windowDays:30};
      const generated=Array.isArray(saved)&&saved.length===3?{touches:saved}:await writeIntelligentCopy(env,{userId:shop.user_id,kind:"recovery",store:shop.shop_domain.replace(/\.myshopify\.com$/i,""),evidence,shape:'{"touches":[{"delayLabel":"string","subject":"string","body":"string with {{checkout_url}}"}]} exactly 3 touches',fallback:{touches:DEFAULT_TOUCHES}});
      const touches=Array.isArray(generated.touches)&&generated.touches.length===3&&generated.touches.every(touch=>typeof touch.subject==="string"&&typeof touch.body==="string"&&touch.body.includes("{{checkout_url}}"))?generated.touches:DEFAULT_TOUCHES;
      const inserted = await fetch(`${env.supabaseUrl}/rest/v1/recovery_campaigns?select=id`, {
        method: "POST", headers: { ...h(env), Prefer: "return=representation" },
        body: JSON.stringify({ user_id: shop.user_id, status: "proposed", touches, cart_count: carts.length, total_value: totalValue, currency: null }),
      });
      if (inserted.ok) {const id=(await inserted.json()as{id:string}[])[0]?.id;if(id)await recordCanonicalProposal(env,{userId:shop.user_id,kind:"recovery",legacyTable:"recovery_campaigns",legacyId:id,fingerprint:`recovery:${carts.map(cart=>cart.id).sort().join(",")}`,title:"Abandoned-cart recovery",audienceCount:carts.length,audienceValue:totalValue,evidence,strategy:{touches,continuousEnrollment:true},confidence:.9});proposed++;} else errors++;
    } catch { errors++; }
  }
  log("info", "recovery-observer", "run", { shops: shops.length, proposed, skipped, errors });
  return { shops: shops.length, proposed, skipped, errors };
}

export async function runRecoveryObserverCron(req: Request, env: RecoveryCampaignEnv): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) return json({ error: "Unauthorized." }, 401);
  return json(await detectRecoveryOpportunities(env));
}

export async function runRecoveryUnsubscribe(req: Request, env: RecoveryCampaignEnv): Promise<Response> {
  const url = new URL(req.url); const id = url.searchParams.get("id") ?? ""; const sig = url.searchParams.get("sig") ?? "";
  if (!id || !sig || !env.encryptionKey || !constantEqual(sig, await signValue(env.encryptionKey, id))) return new Response("Invalid or expired unsubscribe link.", { status: 400 });
  const found = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?id=eq.${encodeURIComponent(id)}&select=user_id,checkout_id&limit=1`, { headers: h(env) });
  const row = found.ok ? ((await found.json()) as { user_id: string; checkout_id: string }[])[0] : null;
  if (!row) return new Response("This recovery sequence is already inactive.", { status: 200 });
  const now = new Date().toISOString();
  await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?user_id=eq.${row.user_id}&checkout_id=eq.${encodeURIComponent(row.checkout_id)}&status=eq.queued`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: "cancelled", delivery_status: "unsubscribed", unsubscribed_at: now, error: "Customer unsubscribed from recovery reminders.", updated_at: now }) });
  const conn=await getConnection(env,row.user_id),live=conn?await fetchRecoverableCheckouts(conn,30):null,cart=Array.isArray(live)?live.find(item=>item.id===row.checkout_id):null;
  if(cart?.email)await suppressContact(env,row.user_id,cart.email,"unsubscribed","recovery");
  return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>Unsubscribed</title><body style='font-family:system-ui;max-width:560px;margin:80px auto;padding:24px'><h1>Recovery reminders stopped</h1><p>You will not receive the remaining cart reminder emails from this sequence.</p></body>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function verifySvix(req: Request, body: string, secret: string) {
  const id = req.headers.get("svix-id") ?? ""; const timestamp = req.headers.get("svix-timestamp") ?? ""; const signatures = req.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signatures || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  try {
    const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const secretBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${body}`)))));
    const valid = signatures.split(" ").some((part) => { const [version, value] = part.split(","); return version === "v1" && constantEqual(value ?? "", expected); });
    return valid ? id : null;
  } catch { return null; }
}

export async function runResendWebhook(req: Request, env: RecoveryCampaignEnv): Promise<Response> {
  if (!env.resendWebhookSecret) return json({ error: "Webhook secret is not configured." }, 503);
  const raw = await req.text(); const svixId = await verifySvix(req, raw, env.resendWebhookSecret);
  if (!svixId) return json({ error: "Invalid webhook signature." }, 401);
  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  const type = event.type ?? "unknown"; const emailId = event.data?.email_id ?? "";
  const stored = await fetch(`${env.supabaseUrl}/rest/v1/resend_webhook_events?on_conflict=svix_id`, { method: "POST", headers: { ...h(env), Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ svix_id: svixId, event_type: type, resend_email_id: emailId || null }) });
  if (!stored.ok) return json({ error: "Could not record webhook." }, 502);
  if (!emailId) return json({ ok: true });
  const found = await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,checkout_id&limit=1`, { headers: h(env) });
  const recoveryDelivery = found.ok ? ((await found.json()) as { id: string; user_id: string; checkout_id: string }[])[0] : null;
  const winbackFound = recoveryDelivery ? null : await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,customer_id&limit=1`, { headers: h(env) });
  const winbackDelivery = winbackFound?.ok ? ((await winbackFound.json()) as { id: string; user_id: string; customer_id: string }[])[0] : null;
  const broadcastFound = recoveryDelivery || winbackDelivery ? null : await fetch(`${env.supabaseUrl}/rest/v1/broadcast_deliveries?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,customer_id&limit=1`, { headers: h(env) });
  const broadcastDelivery = broadcastFound?.ok ? ((await broadcastFound.json()) as { id: string; user_id: string; customer_id: string }[])[0] : null;
  const reviewFound = recoveryDelivery || winbackDelivery || broadcastDelivery ? null : await fetch(`${env.supabaseUrl}/rest/v1/review_deliveries?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,order_id&limit=1`, { headers: h(env) });
  const reviewDelivery = reviewFound?.ok ? ((await reviewFound.json()) as { id: string; user_id: string; order_id: string }[])[0] : null;
  const supportFound = recoveryDelivery || winbackDelivery || broadcastDelivery || reviewDelivery ? null : await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id,user_id,order_id&limit=1`, { headers: h(env) });
  const supportNotification = supportFound?.ok ? ((await supportFound.json()) as { id: string; user_id: string; order_id: string }[])[0] : null;
  if (!recoveryDelivery && !winbackDelivery && !broadcastDelivery && !reviewDelivery && !supportNotification) return json({ ok: true });
  const now = new Date().toISOString();
  const status = type.replace(/^email\./, "");
  const patch: Record<string, unknown> = { delivery_status: status, updated_at: now };
  if (status === "delivered") patch.delivered_at = now;
  if (status === "opened") patch.opened_at = now;
  if (status === "clicked") patch.clicked_at = now;
  if (status === "bounced") patch.bounced_at = now;
  if (status === "complained") patch.complained_at = now;
  if (recoveryDelivery) await mark(env, recoveryDelivery.id, patch);
  else if (winbackDelivery) await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?id=eq.${winbackDelivery.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify(patch) });
  else if (broadcastDelivery) await fetch(`${env.supabaseUrl}/rest/v1/broadcast_deliveries?id=eq.${broadcastDelivery.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify(patch) });
  else if (reviewDelivery) await fetch(`${env.supabaseUrl}/rest/v1/review_deliveries?id=eq.${reviewDelivery.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify(patch) });
  else await fetch(`${env.supabaseUrl}/rest/v1/support_notifications?id=eq.${supportNotification!.id}`, { method: "PATCH", headers: h(env), body: JSON.stringify(patch) });
  const marketingDelivery=recoveryDelivery??winbackDelivery??broadcastDelivery??reviewDelivery;if(marketingDelivery)await recordMarketingDeliveryEvent(env,{userId:marketingDelivery.user_id,deliveryId:marketingDelivery.id,emailId,status});
  if (["bounced", "complained", "suppressed", "failed"].includes(status)) {
    if (recoveryDelivery) await fetch(`${env.supabaseUrl}/rest/v1/recovery_deliveries?user_id=eq.${recoveryDelivery.user_id}&checkout_id=eq.${encodeURIComponent(recoveryDelivery.checkout_id)}&status=eq.queued`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: "cancelled", delivery_status: status, error: `Remaining recovery stopped after email ${status}.`, updated_at: now }) });
    else if (winbackDelivery) await fetch(`${env.supabaseUrl}/rest/v1/winback_deliveries?user_id=eq.${winbackDelivery.user_id}&customer_id=eq.${encodeURIComponent(winbackDelivery.customer_id)}&status=eq.queued`, { method: "PATCH", headers: h(env), body: JSON.stringify({ status: "cancelled", delivery_status: status, error: `Remaining win-back emails stopped after email ${status}.`, updated_at: now }) });
    else if (broadcastDelivery) await fetch(`${env.supabaseUrl}/rest/v1/marketing_suppressions?on_conflict=user_id,customer_id`, { method: "POST", headers: { ...h(env), Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ user_id: broadcastDelivery.user_id, customer_id: broadcastDelivery.customer_id, reason: status, created_at: now }) });
    if(recoveryDelivery)await suppressDeliveryContact(env,recoveryDelivery.user_id,recoveryDelivery.id,status,"resend");
    else if(winbackDelivery)await suppressDeliveryContact(env,winbackDelivery.user_id,winbackDelivery.id,status,"resend");
    else if(broadcastDelivery)await suppressDeliveryContact(env,broadcastDelivery.user_id,broadcastDelivery.id,status,"resend");
    else if(reviewDelivery){await suppressDeliveryContact(env,reviewDelivery.user_id,reviewDelivery.id,status,"resend");await fetch(`${env.supabaseUrl}/rest/v1/review_deliveries?user_id=eq.${reviewDelivery.user_id}&order_id=eq.${encodeURIComponent(reviewDelivery.order_id)}&status=eq.queued`,{method:"PATCH",headers:h(env),body:JSON.stringify({status:"cancelled",delivery_status:status,error:`Remaining review contact stopped after email ${status}.`,updated_at:now})});}
  }
  return json({ ok: true });
}

export function recoveryCampaignEnvFromProcess(): RecoveryCampaignEnv {
  const truthy = /^(1|true|yes)$/i.test(process.env.RECOVERY_TEST_MODE ?? "");
  return { supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(), serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(), adminEmails: (process.env.ADMIN_EMAILS ?? "").trim(), shopifyApiKey: (process.env.SHOPIFY_API_KEY ?? "").trim(), shopifyApiSecret: (process.env.SHOPIFY_API_SECRET ?? "").trim(), resendKey: (process.env.RESEND_API_KEY ?? "").trim(), encryptionKey: (process.env.EMAIL_CREDENTIAL_ENCRYPTION_KEY ?? "").trim(), sharedSendingDomain: (process.env.RESEND_SHARED_DOMAIN ?? "runevolution.io").trim(), sharedFromAddress: (process.env.RESEND_SHARED_FROM_ADDRESS ?? "info@runevolution.io").trim(), cronSecret: (process.env.CRON_SECRET ?? "").trim(), recoveryTestMode: truthy, recoveryTestRecipient: (process.env.RECOVERY_TEST_RECIPIENT ?? "").trim(), monthlyEmailLimit: Number(process.env.RECOVERY_MONTHLY_LIMIT ?? 400) || 400, publicOrigin: (process.env.PUBLIC_APP_ORIGIN ?? "https://www.runevolution.io").replace(/\/$/, ""), resendWebhookSecret: (process.env.RESEND_WEBHOOK_SECRET ?? "").trim() };
}
