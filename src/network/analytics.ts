import { supabase } from '../lib/auth';

export const eventNames = ['feed_view', 'post_view', 'post_open', 'form_start', 'form_close', 'agent_reuse', 'logo_picker_open', 'logo_added', 'logo_removed', 'login_click', 'login_request', 'login_sent', 'login_success', 'login_error', 'publish_click', 'form_validation_error', 'publish_attempt', 'publish_success', 'publish_error', 'feed_error', 'checkout_click', 'response_click'] as const;
export type EventName = typeof eventNames[number];
export interface Activity {
  id: string;
  name: EventName;
  visitorId: string;
  sessionId: string;
  flowId: string | null;
  postId: string | null;
  at: string;
  actorId: string | null;
  synced?: boolean;
  rejected?: boolean;
}
export interface Report {
  scope: string;
  counts: { name: string; total: number; visitors: number }[];
  agents: { agent: string; views: number; clicks: number }[];
  journey: { id: string; at: string; name: string; actor: string; actorId?: string | null; visitorId?: string; agent: string | null; seller: string | null; session: string; flow: string | null }[];
}
const prefix = 'evolution:analytics:';
let fallback: Activity[] = [];
let decision: boolean | null = null;
let visitor: string = crypto.randomUUID();
let session: string = crypto.randomUUID();
let lastSeen = 0;
let flushing = false;
let actorId: string | null = null;
const targets = new Map<string, { key: string; agent: string; seller: string }>();

export function setAnalyticsActor(id: string | null) { actorId = id; }
export function setAnalyticsPosts(posts: { id: string; agent: string; agentId?: string; owner: string }[]) {
  for (const post of posts) targets.set(post.id, { key: post.agentId || post.id, agent: post.agent, seller: post.owner });
}

export function consent(): boolean | null {
  try { const value = localStorage.getItem(prefix + 'consent'); if (value === 'yes' || value === 'no') return value === 'yes'; } catch {}
  return decision;
}

export function setConsent(allow: boolean) {
  decision = allow;
  try { localStorage.setItem(prefix + 'consent', allow ? 'yes' : 'no'); if (!allow) { localStorage.removeItem(prefix + 'events'); localStorage.removeItem(prefix + 'visitor'); sessionStorage.removeItem(prefix + 'session'); } } catch {}
  if (!allow) { fallback = []; visitor = crypto.randomUUID(); session = crypto.randomUUID(); lastSeen = 0; }
}

export function localEvents(): Activity[] {
  try {
    const raw = localStorage.getItem(prefix + 'events');
    if (!raw) return fallback;
    const rows = JSON.parse(raw);
    if (Array.isArray(rows)) return rows.filter(row => row && eventNames.includes(row.name) && typeof row.id === 'string' && typeof row.at === 'string' && typeof row.sessionId === 'string' && typeof row.visitorId === 'string');
  } catch {}
  return fallback;
}

function save(rows: Activity[]) {
  fallback = rows.slice(-1000);
  try { localStorage.setItem(prefix + 'events', JSON.stringify(fallback)); } catch {}
}

function identity() {
  const now = Date.now();
  try {
    const saved = localStorage.getItem(prefix + 'visitor');
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) visitor = saved;
    else localStorage.setItem(prefix + 'visitor', visitor);
    const previous = JSON.parse(sessionStorage.getItem(prefix + 'session') || 'null');
    if (previous && typeof previous.id === 'string' && now - previous.at < 30 * 60 * 1000) session = previous.id;
    else if (now - lastSeen >= 30 * 60 * 1000) session = crypto.randomUUID();
    sessionStorage.setItem(prefix + 'session', JSON.stringify({ id: session, at: now }));
  } catch { if (now - lastSeen >= 30 * 60 * 1000) session = crypto.randomUUID(); }
  lastSeen = now;
}

export function track(name: EventName, postId: string | null = null, flowId: string | null = null) {
  if (consent() !== true || !eventNames.includes(name)) return;
  identity();
  const rows = localEvents();
  if (['feed_view', 'post_view'].includes(name) && rows.some(row => row.sessionId === session && row.name === name && row.postId === postId)) return;
  save([...rows, { id: crypto.randomUUID(), name, visitorId: visitor, sessionId: session, flowId, postId, actorId, at: new Date().toISOString() }]);
  void flushEvents();
}

export async function flushEvents() {
  if (!supabase || flushing || consent() !== true) return;
  flushing = true;
  try {
    for (const row of localEvents().filter(event => !event.synced && !event.rejected).slice(0, 200)) {
      if (consent() !== true) break;
      const { error } = await supabase.rpc('network_record_event', { event_input: row });
      if (error) {
        const permanent = ['22P02', '22007'].includes(error.code) || /^(Invalid event|Unknown post|Post required|Only the publisher|Demo has no checkout)/.test(error.message);
        if (permanent && consent() === true) { save(localEvents().map(event => event.id === row.id ? { ...event, rejected: true } : event)); continue; }
        break;
      }
      if (consent() === true) save(localEvents().map(event => event.id === row.id ? { ...event, synced: true } : event));
    }
  } catch {} finally { flushing = false; }
}

export function localReport(): Report {
  const rows = localEvents().filter(row => Date.parse(row.at) >= Date.now() - 30 * 86400000);
  const counts = eventNames.map(name => { const matches = rows.filter(row => row.name === name); return { name, total: matches.length, visitors: new Set(matches.map(row => row.visitorId)).size }; });
  const ids = [...new Set(rows.map(row => row.postId).filter((id): id is string => !!id))];
  return { scope: 'Local preview · this browser only · up to 1,000 events', counts, agents: ids.map(id => ({ agent: targets.get(id)?.agent || id, views: rows.filter(row => row.postId === id && row.name === 'post_view').length, clicks: rows.filter(row => row.postId === id && row.name === 'checkout_click').length })), journey: [...rows].reverse().slice(0, 100).map(row => ({ id: row.id, at: row.at, name: row.name, actorId: row.actorId, visitorId: row.visitorId, actor: row.actorId ? 'Account ' + row.actorId.slice(0, 8) : 'Visitor ' + row.visitorId.slice(0, 8), agent: row.postId ? targets.get(row.postId)?.agent || row.postId : null, seller: row.postId ? targets.get(row.postId)?.seller || null : null, session: row.sessionId, flow: row.flowId })) };
}

export async function readReport(): Promise<Report> {
  if (!supabase) return localReport();
  await flushEvents();
  const { data, error } = await supabase.rpc('network_analytics_report');
  if (error) throw new Error('Sign in to view your analytics. Shared analytics also needs its database migration.');
  return data as Report;
}

export function syncStatus() {
  const rows = localEvents();
  return { shared: !!supabase, pending: rows.filter(row => !row.synced && !row.rejected).length, rejected: rows.filter(row => row.rejected).length };
}
