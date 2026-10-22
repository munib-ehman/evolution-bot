import { topics } from './topics.mjs';
import { safeAgentUrl } from './model.mjs';

export function validateRequest(input) {
  const draft = {};
  for (const [field, limit] of Object.entries({ title: 100, owner: 80, text: 1000 })) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > limit) throw new Error(`Enter ${field} (1–${limit} characters).`);
    draft[field] = value;
  }
  if (!topics.includes(input.category)) throw new Error('Choose a topic.');
  const responseUrl = safeAgentUrl(input.responseUrl);
  if (!responseUrl || responseUrl.length > 2048) throw new Error('Enter a valid HTTPS link where builders can respond.');
  return { ...draft, category: input.category, responseUrl };
}

export function requestPost(input, id = crypto.randomUUID(), publishedAt = new Date().toISOString()) {
  const draft = validateRequest(input);
  return { ...draft, id, kind: 'request', agent: draft.title, initials: draft.owner.slice(0, 2), color: 'lavender', role: '', sample: '', input: draft.text, output: '', preview: [], publishedAt, demo: false, autonomyTested: false, tryUrl: null };
}
