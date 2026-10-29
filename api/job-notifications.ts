import { resolveUserFull } from './_audit';
import { sameOriginOk } from './_auth';
import { recoveryCampaignEnvFromProcess } from './_recoveryCampaigns';

export const config = { runtime: 'edge', maxDuration: 60 };
type Mail = { id: string; recipient_id: string; subject: string; body: string; reply_to: string | null };

export default async function handler(request: Request): Promise<Response> {
  const env = recoveryCampaignEnvFromProcess();
  const authorization = request.headers.get('authorization');
  const cron = Boolean(env.cronSecret && authorization === `Bearer ${env.cronSecret}`);
  if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed' }, { status: 405 });
  if (!cron && (request.method !== 'POST' || !sameOriginOk(request))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.supabaseUrl || !env.serviceRoleKey) return Response.json({ error: 'Notification database is not configured' }, { status: 503 });
  const actor = cron ? null : await resolveUserFull(env, authorization);
  if (!cron && !actor) return Response.json({ error: 'Sign in first' }, { status: 401 });
  if (!env.resendKey) return Response.json({ error: 'Email delivery is not configured. Notifications remain queued.' }, { status: 503 });
  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, 'Content-Type': 'application/json' };
  const base = `${env.supabaseUrl}/rest/v1`;
  async function database(path: string, options: RequestInit = {}) {
    const response = await fetch(`${base}/${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Notification database unavailable');
    return response;
  }
  try {
    if (new URL(request.url).searchParams.get('test') === '1') {
      if (!actor?.email || cron) return Response.json({ error: 'Owner access required' }, { status: 403 });
      const permission = await fetch(`${base}/rpc/evolution_is_admin`, { method: 'POST', headers: { ...headers, Authorization: authorization! }, body: '{}', signal: AbortSignal.timeout(8000) });
      if (!permission.ok || await permission.json() !== true) return Response.json({ error: 'Owner access required' }, { status: 403 });
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.sharedFromAddress || 'Evolution <info@runevolution.io>', to: [actor.email], subject: 'Evolution notification delivery check', text: 'This is the owner-requested delivery check for Evolution job notifications. No job or application was created and no developer or business was contacted.' }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json() as { id?: string };
      return Response.json(response.ok && result.id ? { accepted: true, id: result.id } : { error: `Email provider rejected delivery (${response.status})` }, { status: response.ok && result.id ? 200 : 502 });
    }
    const mails = await (await database('rpc/evolution_claim_mail', { method: 'POST', body: JSON.stringify({ actor: actor?.id || null }) })).json() as Mail[];
    let sent = 0;
    let failed = 0;
    const started = Date.now();
    for (const [index, mail] of mails.entries()) {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 600));
      if (Date.now() - started > 35000) {
        for (const remaining of mails.slice(index)) await database(`evolution_mail_queue?id=eq.${remaining.id}&state=eq.sending`, { method: 'PATCH', body: JSON.stringify({ state: 'pending' }) });
        break;
      }
      let state = 'uncertain';
      let providerId: string | null = null;
      let backoff = false;
      try {
        const recipients = await (await database(`evolution_users?id=eq.${mail.recipient_id}&select=email&limit=1`)).json() as { email: string }[];
        if (!recipients[0]) throw new Error('Recipient unavailable');
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `evolution-job-${mail.id}` },
          body: JSON.stringify({ from: env.sharedFromAddress || 'Evolution <info@runevolution.io>', to: [recipients[0].email], subject: mail.subject, text: mail.body, ...(mail.reply_to ? { reply_to: mail.reply_to } : {}) }),
          signal: AbortSignal.timeout(4000),
        });
        if (response.ok) {
          const result = await response.json() as { id?: string };
          if (result.id) { providerId = result.id; state = 'sent'; sent++; }
        } else { state = response.status === 429 ? 'pending' : response.status >= 500 ? 'uncertain' : 'failed'; failed++; backoff = true; }
      } catch { failed++; backoff = true; }
      await database(`evolution_mail_queue?id=eq.${mail.id}&state=eq.sending`, { method: 'PATCH', body: JSON.stringify({ state, provider_id: providerId }) });
      if (backoff) {
        for (const remaining of mails.slice(index + 1)) await database(`evolution_mail_queue?id=eq.${remaining.id}&state=eq.sending`, { method: 'PATCH', body: JSON.stringify({ state: 'pending' }) });
        break;
      }
    }
    return Response.json({ processed: mails.length, accepted: sent, failed }, { status: failed ? 502 : 200 });
  } catch {
    return Response.json({ error: 'Notification processing failed. Saved jobs and applications are unchanged.' }, { status: 503 });
  }
}
