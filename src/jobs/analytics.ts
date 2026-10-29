import { supabase } from '../lib/auth';

export const activityNames = ['board_view','request_impression','request_open','request_start','offer_start','login_start','login_link_sent','signed_in','form_started','form_error','publish_click','response_click','contact_email','contact_linkedin','contact_x','contact_page','example_view','example_use','theme_change'] as const;
export type ActivityName = typeof activityNames[number];
const consentKey = 'evolution:analytics:consent';
const identityKey = 'evolution:journey:v1';
type Identity = { visitorId: string; visitorToken: string; sessionId: string; lastSeen: number; actorId: string | null };
let memory: Identity | null = null;
let lastActor: string | null = null;
let sending = false;
let pending: Record<string, unknown>[] = [];
const seen = new Set<string>();

export function usageConsent(): boolean | null {
  try { const choice = localStorage.getItem(consentKey); return choice === 'yes' ? true : choice === 'no' ? false : null; } catch { return null; }
}

export function changeUsageConsent(allow: boolean) {
  try { localStorage.setItem(consentKey, allow ? 'yes' : 'no'); if (!allow) sessionStorage.removeItem(identityKey); } catch {}
  if (!allow) { memory = null; pending = []; seen.clear(); }
}

function identity() {
  const now = Date.now();
  if (!memory) {
    try { memory = JSON.parse(sessionStorage.getItem(identityKey) || 'null'); } catch {}
  }
  if (!memory || now-memory.lastSeen>30*60*1000 || (memory.actorId && memory.actorId !== lastActor)) {
    memory = { visitorId: crypto.randomUUID(), visitorToken: crypto.randomUUID(), sessionId: crypto.randomUUID(), lastSeen: now, actorId: lastActor };
    seen.clear();
  }
  memory.lastSeen = now; memory.actorId = lastActor;
  try { sessionStorage.setItem(identityKey, JSON.stringify(memory)); } catch {}
  return memory;
}

export function usageActor(id: string | null) {
  if (lastActor && lastActor !== id) { memory = null; pending = []; seen.clear(); try { sessionStorage.removeItem(identityKey); } catch {} }
  lastActor = id;
}

export async function flushUsage() {
  if (sending || !supabase || usageConsent() !== true) return;
  sending = true;
  try {
    while (pending.length && usageConsent() === true) {
      const event = pending[0];
      const result = await supabase.rpc('evolution_record_event', { event_input: event });
      if (result.error) {
        if (/Invalid|Unknown|Request required|Example required|check constraint/.test(result.error.message)) { pending.shift(); continue; }
        break;
      }
      pending.shift();
    }
  } catch {} finally { sending = false; }
}

export function trackUsage(name: ActivityName, target?: string) {
  if (usageConsent() !== true || !activityNames.includes(name)) return;
  const current = identity();
  const key = `${current.sessionId}:${name}:${target || ''}`;
  if (['board_view','request_impression','request_open','form_started','signed_in'].includes(name) && seen.has(key)) return;
  seen.add(key);
  pending.push({ id: crypto.randomUUID(), name, visitorId: current.visitorId, visitorToken: current.visitorToken, sessionId: current.sessionId, consented: true, ...(target?.startsWith('example-') ? { exampleKey: target } : target ? { jobId: target } : {}) });
  pending = pending.slice(-100);
  void flushUsage();
}

export const activityLabels: Record<string, string> = {
  board_view:'Opened agent requests',request_impression:'Saw a request',request_open:'Opened full request',request_start:'Clicked Request an Agent',offer_start:'Clicked Offer an Agent',login_start:'Opened email login',login_link_sent:'Requested a sign-in email',signed_in:'Signed in',form_started:'Started completing a form',form_error:'Could not complete a form',publish_click:'Clicked Publish Request',response_click:'Clicked Respond',contact_email:'Clicked contact email',contact_linkedin:'Clicked LinkedIn contact',contact_x:'Clicked X contact',contact_page:'Clicked contact page',example_view:'Opened an example brief',example_use:'Used an example brief',theme_change:'Changed appearance',account_created:'Created an account',request_published:'Published an agent request',response_saved:'Submitted an agent response',
};
