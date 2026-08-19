import { resolveUserFull, type AuditEnv } from "./_audit";
import { hasRole, roleRequired, type Role } from "./_plan";

export interface EmailDeliveryEnv extends AuditEnv {
  resendKey?: string;
  encryptionKey?: string;
  sharedSendingDomain?: string;
  sharedFromAddress?: string;
}

export interface EmailDeliverySettings {
  mode: "merchant_domain" | "merchant_resend" | "evolution_shared";
  status: "pending" | "verified" | "test_required" | "ready" | "error";
  sendingDomain: string | null;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  dnsRecords: { record?: string; name?: string; type?: string; value?: string; priority?: number; status?: string }[];
  fallbackWarningAcknowledged: boolean;
  providerAccountConnected: boolean;
  testSentAt: string | null;
}

export type EmailDeliveryRow = {
  role: EmailRole;
  mode: EmailDeliverySettings["mode"];
  status: EmailDeliverySettings["status"];
  sending_domain?: string | null;
  sender_name: string;
  sender_email: string;
  reply_to: string;
  dns_records?: EmailDeliverySettings["dnsRecords"];
  fallback_warning_acknowledged?: boolean;
  provider_secret_ciphertext?: string | null;
  provider_domain_id?: string | null;
  test_sent_at?: string | null;
};
type Row = EmailDeliveryRow;
export type EmailRole = Extract<Role, "marketing" | "customer-success" | "operations">;
const emailRole = (value: unknown): EmailRole | null => value === "marketing" || value === "customer-success" || value === "operations" ? value : null;

const headers = (env: EmailDeliveryEnv): Record<string, string> => {
  const key = env.serviceRoleKey ?? "";
  return { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", "User-Agent": "EvolutionBackend/1.0" };
};
const clean = (v: unknown, max = 160) => typeof v === "string" ? v.trim().slice(0, max) : "";
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const domainOk = (v: string) => /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(v);

function publicSettings(row: Row): EmailDeliverySettings {
  return {
    mode: row.mode, status: row.status, sendingDomain: row.sending_domain ?? null,
    senderName: row.sender_name, senderEmail: row.sender_email, replyTo: row.reply_to,
    dnsRecords: Array.isArray(row.dns_records) ? row.dns_records : [],
    fallbackWarningAcknowledged: Boolean(row.fallback_warning_acknowledged),
    providerAccountConnected: Boolean(row.provider_secret_ciphertext), testSentAt: row.test_sent_at ?? null,
  };
}

async function encrypt(secret: string, rawKey: string): Promise<string | null> {
  if (!rawKey) return null;
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...cipher))}`;
}

async function decrypt(value: string, rawKey: string): Promise<string | null> {
  try {
    const [ivText, cipherText] = value.split(".");
    const from64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: from64(ivText) }, key, from64(cipherText));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

export async function loadEmailDeliveryRow(env: EmailDeliveryEnv, userId: string, role: EmailRole = "marketing"): Promise<Row | null> {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/email_delivery_settings?user_id=eq.${userId}&role=eq.${role}&select=*&limit=1`, { headers: headers(env) });
  if (!res.ok) return null;
  return ((await res.json()) as Row[])[0] ?? null;
}
const load = loadEmailDeliveryRow;

async function auth(env: EmailDeliveryEnv, authHeader: string | null, role: EmailRole) {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { error: new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: { "Content-Type": "application/json" } }) };
  if (!(await hasRole(env, user.id, role, user.email))) { const denied=roleRequired(role); return { error: new Response(JSON.stringify(denied.body), { status: denied.status, headers: { "Content-Type": "application/json" } }) }; }
  return { user };
}

export async function runEmailDeliveryGet(authHeader: string | null, env: EmailDeliveryEnv, roleValue: unknown): Promise<Response> {
  const role=emailRole(roleValue); if(!role)return Response.json({error:"Choose the manager that will send email."},{status:400});
  const checked = await auth(env, authHeader, role); if ("error" in checked) return checked.error!;
  const row = await load(env, checked.user.id, role);
  return Response.json({ settings: row ? publicSettings(row) : null });
}

export async function runEmailDeliverySave(body: Record<string, unknown>, authHeader: string | null, env: EmailDeliveryEnv): Promise<Response> {
  const role=emailRole(body.role); if(!role)return Response.json({error:"Choose the manager that will send email."},{status:400});
  const checked = await auth(env, authHeader, role); if ("error" in checked) return checked.error!;
  const mode = clean(body.mode) as EmailDeliverySettings["mode"];
  if (!(["merchant_domain", "merchant_resend", "evolution_shared"] as string[]).includes(mode)) return Response.json({ error: "Choose a delivery method." }, { status: 400 });
  const senderName = clean(body.senderName, 80);
  let senderEmail = clean(body.senderEmail).toLowerCase();
  if (clean(body.mode) === "evolution_shared") senderEmail = (env.sharedFromAddress || "info@runevolution.io").toLowerCase();
  const replyTo = (clean(body.replyTo).toLowerCase() || senderEmail);
  if (!senderName) return Response.json({ error: "Enter the customer-facing store name." }, { status: 400 });
  if (!emailOk(senderEmail)) return Response.json({ error: "Enter a valid From address." }, { status: 400 });
  if (!emailOk(replyTo)) return Response.json({ error: "Enter a valid Reply-To address, or leave it empty to use the From address." }, { status: 400 });
  let domain = clean(body.sendingDomain).toLowerCase();
  let status: EmailDeliverySettings["status"] = "pending";
  let dnsRecords: EmailDeliverySettings["dnsRecords"] = [];
  let providerDomainId: string | null = null;
  let cipher: string | null = null;
  const fallbackAck = body.fallbackWarningAcknowledged === true;

  if (mode === "evolution_shared") {
    if (!fallbackAck) return Response.json({ error: "Acknowledge the trust warning before using Evolution's shared domain." }, { status: 400 });
    domain = (env.sharedSendingDomain || "runevolution.io").toLowerCase(); status = "test_required";
    if (!senderEmail.endsWith(`@${domain}`)) return Response.json({ error: "The configured shared sender does not match the verified shared domain." }, { status: 500 });
  } else {
    if (!domainOk(domain) || !senderEmail.endsWith(`@${domain}`)) return Response.json({ error: "The sender email must use the sending domain you entered." }, { status: 400 });
    const providerKey = mode === "merchant_resend" ? clean(body.providerApiKey, 220) : env.resendKey ?? "";
    if (!providerKey) return Response.json({ error: mode === "merchant_resend" ? "Enter the merchant Resend API key." : "Managed domain onboarding is not configured on this deployment." }, { status: 409 });
    const domainRes = await fetch("https://api.resend.com/domains", { method: "POST", headers: { Authorization: `Bearer ${providerKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: domain }) });
    const domainBody = await domainRes.json().catch(() => ({})) as { id?: string; records?: EmailDeliverySettings["dnsRecords"]; message?: string };
    if (!domainRes.ok && domainRes.status !== 409) return Response.json({ error: domainBody.message ?? "Resend could not add this domain." }, { status: 502 });
    providerDomainId = domainBody.id ?? null; dnsRecords = domainBody.records ?? []; status = "pending";
    if (!providerDomainId && domainRes.status === 409) {
      const listRes = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${providerKey}` } });
      const listBody = await listRes.json().catch(() => ({})) as { data?: { id?: string; name?: string; status?: string }[] };
      const existing = listBody.data?.find((item) => item.name?.toLowerCase() === domain);
      if (!existing?.id) return Response.json({ error: "This domain exists in Resend but could not be connected. Check that the API key belongs to the same Resend account." }, { status: 409 });
      providerDomainId = existing.id;
      status = existing.status === "verified" ? "test_required" : "pending";
    }
    if (mode === "merchant_resend") {
      cipher = await encrypt(providerKey, env.encryptionKey ?? "");
      if (!cipher) return Response.json({ error: "Server credential encryption is not configured." }, { status: 409 });
    }
  }

  const payload = { user_id: checked.user.id, role, mode, status, sending_domain: domain, sender_name: senderName, sender_email: senderEmail, reply_to: replyTo, provider: "resend", provider_domain_id: providerDomainId, provider_secret_ciphertext: cipher, dns_records: dnsRecords, fallback_warning_acknowledged: fallbackAck, updated_at: new Date().toISOString() };
  const saved = await fetch(`${env.supabaseUrl}/rest/v1/email_delivery_settings?on_conflict=user_id,role`, { method: "POST", headers: { ...headers(env), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  if (!saved.ok) return Response.json({ error: "Could not save email delivery settings. Run the email delivery database migration first." }, { status: 502 });
  return Response.json({ settings: publicSettings(((await saved.json()) as Row[])[0]) });
}

export async function emailDeliveryProviderKey(env: EmailDeliveryEnv, row: Row): Promise<string | null> {
  if (row.mode !== "merchant_resend") return env.resendKey ?? null;
  if (!row.provider_secret_ciphertext || !env.encryptionKey) return null;
  return decrypt(row.provider_secret_ciphertext, env.encryptionKey);
}
const providerKey = emailDeliveryProviderKey;

export async function runEmailDeliveryCheck(authHeader: string | null, env: EmailDeliveryEnv, roleValue: unknown): Promise<Response> {
  const role=emailRole(roleValue); if(!role)return Response.json({error:"Choose the manager that will send email."},{status:400});
  const checked = await auth(env, authHeader, role); if ("error" in checked) return checked.error!;
  const row = await load(env, checked.user.id, role); if (!row) return Response.json({ error: "Save delivery settings first." }, { status: 409 });
  if (row.mode === "evolution_shared") return Response.json({ settings: publicSettings(row) });
  const key = await providerKey(env, row);
  if (!key || !row.provider_domain_id) return Response.json({ error: "Provider connection is incomplete. Save the setup again." }, { status: 409 });
  const res = await fetch(`https://api.resend.com/domains/${row.provider_domain_id}`, { headers: { Authorization: `Bearer ${key}` } });
  const result = await res.json().catch(() => ({})) as { status?: string; records?: EmailDeliverySettings["dnsRecords"]; message?: string };
  if (!res.ok) return Response.json({ error: result.message ?? "Could not check domain verification." }, { status: 502 });
  const status: EmailDeliverySettings["status"] = result.status === "verified" ? "test_required" : "pending";
  const update = await fetch(`${env.supabaseUrl}/rest/v1/email_delivery_settings?user_id=eq.${checked.user.id}&role=eq.${role}`, { method: "PATCH", headers: { ...headers(env), Prefer: "return=representation" }, body: JSON.stringify({ status, dns_records: result.records ?? row.dns_records ?? [], verified_at: status === "test_required" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }) });
  return Response.json({ settings: publicSettings(((await update.json()) as Row[])[0]) });
}

export async function runEmailDeliveryTest(authHeader: string | null, env: EmailDeliveryEnv, roleValue: unknown): Promise<Response> {
  const role=emailRole(roleValue); if(!role)return Response.json({error:"Choose the manager that will send email."},{status:400});
  const checked = await auth(env, authHeader, role); if ("error" in checked) return checked.error!;
  const row = await load(env, checked.user.id, role); if (!row || row.status !== "test_required") return Response.json({ error: "Verify the sending identity before testing." }, { status: 409 });
  const key = await providerKey(env, row); if (!key) return Response.json({ error: "Email provider is not configured." }, { status: 409 });
  const test = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `delivery-test/${checked.user.id}/${Date.now()}` }, body: JSON.stringify({ from: `${row.sender_name} <${row.sender_email}>`, to: [row.reply_to], reply_to: row.reply_to, subject: `Your ${row.sender_name} sending identity is ready`, text: `This is a private delivery test from Evolution. Customers will see emails from ${row.sender_name} <${row.sender_email}> and replies will go to ${row.reply_to}. No customer campaign was sent.` }) });
  const result = await test.json().catch(() => ({})) as { message?: string };
  if (!test.ok) return Response.json({ error: result.message ?? "The provider rejected the test email." }, { status: 502 });
  const now = new Date().toISOString();
  const update = await fetch(`${env.supabaseUrl}/rest/v1/email_delivery_settings?user_id=eq.${checked.user.id}&role=eq.${role}`, { method: "PATCH", headers: { ...headers(env), Prefer: "return=representation" }, body: JSON.stringify({ status: "ready", test_sent_at: now, updated_at: now }) });
  return Response.json({ settings: publicSettings(((await update.json()) as Row[])[0]) });
}

export function emailDeliveryEnvFromProcess(): EmailDeliveryEnv {
  return { supabaseUrl: (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim(), serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(), adminEmails: (process.env.ADMIN_EMAILS ?? "").trim(), resendKey: (process.env.RESEND_API_KEY ?? "").trim(), encryptionKey: (process.env.EMAIL_CREDENTIAL_ENCRYPTION_KEY ?? "").trim(), sharedSendingDomain: (process.env.RESEND_SHARED_DOMAIN ?? "runevolution.io").trim(), sharedFromAddress: (process.env.RESEND_SHARED_FROM_ADDRESS ?? "info@runevolution.io").trim() };
}
