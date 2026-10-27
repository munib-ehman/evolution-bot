import { topics } from './topics.mjs';
import { safeAgentUrl } from './model.mjs';

export function validateRequest(input, existing = false) {
  const draft = {};
  for (const [field, limit] of Object.entries({ title: 100, owner: 80, text: existing ? 1000 : 600 })) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > limit) throw new Error(`Enter ${field} (1–${limit} characters).`);
    draft[field] = value;
  }
  if (!existing && draft.text.length < 80) throw new Error('Describe the outcome, inputs and completion criteria in 80–600 characters.');
  const budget = input.budget == null || input.budget === '' ? null : Number(input.budget);
  if ((!existing || budget !== null) && (!Number.isFinite(budget) || budget <= 0 || budget > 1000000 || Math.abs(budget * 100 - Math.round(budget * 100)) > .000001)) throw new Error('Enter a USD budget from $0.01 to $1,000,000, with at most two decimals.');
  if (!topics.includes(input.category)) throw new Error('Choose a topic.');
  const responseUrl = safeAgentUrl(input.responseUrl);
  if (!responseUrl || responseUrl.length > 2048) throw new Error('Enter a valid HTTPS link where builders can respond.');
  return { ...draft, budget, category: input.category, responseUrl };
}

export function requestPost(input, id = crypto.randomUUID(), publishedAt = new Date().toISOString()) {
  const draft = validateRequest(input, true);
  return { ...draft, id, kind: 'request', agent: draft.title, initials: draft.owner.slice(0, 2), color: 'lavender', role: '', sample: '', input: draft.text, output: '', preview: [], publishedAt, demo: false, autonomyTested: false, tryUrl: null };
}
