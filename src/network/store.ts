import { supabase } from '../lib/auth';
import { localPost, sortedPosts, validateDraft, type AgentPost } from './model.mjs';
import { requestPost, validateRequest } from './requests.mjs';

const localKey = 'evolution:network:posts:v1';

export function readLocalPosts(): AgentPost[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(localKey) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => {
      if (row?.kind === 'request') {
        try { validateRequest({ ...row, title: row.agent }); return typeof row.id === 'string' && Number.isFinite(Date.parse(row.publishedAt)) && row.demo === false; } catch { return false; }
      }
      try { validateDraft(row); return typeof row.id === 'string' && typeof row.agentId === 'string' && Number.isFinite(Date.parse(row.publishedAt)) && row.demo === false && ['sage', 'clay', 'lavender'].includes(row.color); } catch { return false; }
    });
  } catch { return []; }
}

export async function readFeed(): Promise<AgentPost[]> {
  if (!supabase) return readLocalPosts();
  const { data, error } = await supabase.from('network_posts').select('*, agent:network_agents(*)').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('The shared feed is unavailable. Apply the v3 database migration and check access settings.');
  return (data || []).map(row => {
    if (row.kind === 'request') return requestPost({ title: row.request_title, owner: row.requester_name, text: row.task, category: row.category, responseUrl: row.response_url }, row.id, row.created_at);
    const agent = row.agent;
    const category = row.category;
    return { category, id: row.id, agentId: agent.id, agent: agent.name, initials: agent.name.slice(0, 2), color: agent.color, owner: agent.builder_name, audience: agent.audience, role: agent.deliverable, text: row.task, sample: row.result, input: row.task, output: row.result, preview: [], price: Number(agent.price), currency: agent.currency, sellerReportedHires: agent.seller_reported_hires, checkoutUrl: agent.checkout_url, autonomyClaimed: agent.autonomy_claimed, logoData: agent.logo_data, publishedAt: row.created_at, demo: false, autonomyTested: false, tryUrl: null };
  });
}

export async function publishPost(input: Record<string, unknown>, onPublished?: (id: string) => void): Promise<AgentPost[]> {
  const draft = validateDraft(input);
  if (!supabase) {
    const previous = readLocalPosts();
    const next = localPost(draft as unknown as Record<string, unknown>, previous);
    const rows = sortedPosts([next, ...previous.map(row => row.agentId === next.agentId ? { ...row, sellerReportedHires: next.sellerReportedHires, price: next.price, currency: next.currency, checkoutUrl: next.checkoutUrl, role: next.role, owner: next.owner, audience: next.audience, logoData: next.logoData } : row)]).slice(0, 100);
    try { localStorage.setItem(localKey, JSON.stringify(rows)); } catch { throw new Error('Browser storage is unavailable. Your post was not saved.'); }
    onPublished?.(next.id);
    return rows;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to publish your post.');
  const { data: postId, error } = await supabase.rpc('network_publish_post', { draft });
  if (error) throw new Error('Could not confirm publication. Refresh the feed before retrying; check your session and the v3 database migration.');
  onPublished?.(postId);
  try { return await readFeed(); } catch { throw new Error('Post published, but the feed could not refresh. Reload before posting again.'); }
}

export async function ownAgents(userId: string | null): Promise<AgentPost[]> {
  if (!supabase) return readLocalPosts().filter((row, index, rows) => row.kind !== 'request' && rows.findIndex(other => other.agentId === row.agentId) === index);
  if (!userId) return [];
  const { data, error } = await supabase.from('network_agents').select('*').eq('seller_id', userId).order('name');
  if (error) throw new Error('Could not load your agents.');
  return (data || []).map(agent => ({ id: agent.id, agentId: agent.id, agent: agent.name, initials: agent.name.slice(0, 2), color: agent.color, owner: agent.builder_name, audience: agent.audience, role: agent.deliverable, text: '', sample: '', input: '', output: '', preview: [], price: Number(agent.price), currency: agent.currency, sellerReportedHires: agent.seller_reported_hires, checkoutUrl: agent.checkout_url, autonomyClaimed: agent.autonomy_claimed, logoData: agent.logo_data, publishedAt: agent.created_at, demo: false, autonomyTested: false, tryUrl: null }));
}

export async function publishRequest(input: Record<string, unknown>, onPublished?: (id: string) => void): Promise<AgentPost[]> {
  const draft = validateRequest(input);
  if (!supabase) {
    const next = requestPost(draft);
    const rows = sortedPosts([next, ...readLocalPosts()]).slice(0, 100);
    try { localStorage.setItem(localKey, JSON.stringify(rows)); } catch { throw new Error('Browser storage is unavailable. Your request was not saved.'); }
    onPublished?.(next.id);
    return rows;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to publish your request.');
  const { data: id, error } = await supabase.rpc('network_publish_request', { draft });
  if (error) throw new Error('Could not confirm the request. Refresh before retrying; the request-post database update may still be pending.');
  onPublished?.(id);
  try { return await readFeed(); } catch { throw new Error('Request published, but the feed could not refresh. Reload before posting again.'); }
}
