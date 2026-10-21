import { topics } from './topics.mjs';

export function safeAgentUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function canTry(post) {
  return post.demo === false && post.autonomyTested === true && safeAgentUrl(post.tryUrl) !== null;
}

export function canHire(post) {
  return post.demo === false && post.autonomyClaimed === true && safeAgentUrl(post.checkoutUrl) !== null;
}

export function safeLogo(value) {
  if (typeof value !== 'string' || value.length > 180000) return null;
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

export function validateDraft(input) {
  const limits = { agent: 60, owner: 80, audience: 140, role: 180, text: 1000, sample: 1400 };
  const draft = {};
  for (const [field, limit] of Object.entries(limits)) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > limit) throw new Error(`${field}: enter between 1 and ${limit} characters.`);
    draft[field] = value;
  }
  const price = String(input.price ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(price) || Number(price) > 1000000) throw new Error('Enter a price from 0 to 1,000,000 with up to two decimals.');
  const hires = String(input.sellerReportedHires ?? '').trim();
  if (!/^\d{1,10}$/.test(hires) || Number(hires) > 1000000000) throw new Error('Hires must be a whole number from 0 to 1,000,000,000.');
  if (!['USD', 'EUR', 'GBP', 'PKR'].includes(input.currency)) throw new Error('Choose a supported currency.');
  const checkoutUrl = safeAgentUrl(input.checkoutUrl);
  if (!checkoutUrl || checkoutUrl.length > 2048) throw new Error('Enter a valid HTTPS checkout link without embedded credentials (up to 2048 characters).');
  if (input.autonomyClaimed !== true) throw new Error('Confirm the agent completes the task without a human operator.');
  const logoData = input.logoData ? safeLogo(input.logoData) : null;
  if (input.logoData && !logoData) throw new Error('Upload a PNG, JPEG or WebP logo. The processed logo must be under 135 KB.');
  if (input.category != null && !topics.includes(input.category)) throw new Error('Choose a topic for your agent post.');
  return { ...draft, category: input.category || null, price: Number(price), currency: input.currency, sellerReportedHires: Number(hires), checkoutUrl, autonomyClaimed: true, logoData };
}

export function reportedHires(post, posts) {
  const current = sortedPosts(posts).find(candidate => (candidate.agentId || candidate.id) === (post.agentId || post.id));
  const count = current?.sellerReportedHires;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function localPost(input, previous, now = new Date().toISOString(), id = crypto.randomUUID()) {
  const draft = validateDraft(input);
  const agentId = 'local:' + draft.agent.toLowerCase();
  const colors = ['sage', 'clay', 'lavender'];
  const matching = previous.find(post => post.agentId === agentId);
  return { ...draft, id, agentId, initials: draft.agent.slice(0, 2), color: matching?.color || colors[previous.length % colors.length], input: draft.text, output: draft.sample, preview: [], publishedAt: now, demo: false, autonomyTested: false, tryUrl: null };
}

export function recordHireClick(storage, postId, now = new Date().toISOString()) {
  try {
    const raw = JSON.parse(storage.getItem('evolution:network:hire-clicks:v1') || '[]');
    const previous = Array.isArray(raw) ? raw : [];
    storage.setItem('evolution:network:hire-clicks:v1', JSON.stringify([...previous.slice(-499), { postId, at: now, event: 'hire_clicked' }]));
    return true;
  } catch {
    return false;
  }
}

export function sortedPosts(posts) {
  return [...posts].sort((first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt));
}

export function recordTry(storage, postId, now = new Date().toISOString()) {
  if (!storage) return false;
  try {
    const previous = JSON.parse(storage.getItem('evolution:network:try-clicks:v1') || '[]');
    const events = Array.isArray(previous) ? previous : [];
    storage.setItem('evolution:network:try-clicks:v1', JSON.stringify([...events.slice(-499), { postId, at: now, event: 'try_clicked' }]));
    return true;
  } catch {
    return false;
  }
}
