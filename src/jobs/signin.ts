const draftKey = 'evolution:request-draft:v2';
const draftFields = ['requester_name', 'title', 'description', 'frequency', 'budget', 'email', 'contact_email', 'contact_linkedin', 'contact_x', 'contact_url'];
const pendingKey = 'evolution:pending-signin:v1';

export function savePendingSignIn(storage: Storage, email: string, action: string, name = '', now = Date.now()) {
  storage.setItem(pendingKey, JSON.stringify({ email: email.trim().toLowerCase(), action, name, savedAt: now }));
}

export function readPendingSignIn(storage: Storage, email?: string, now = Date.now()): { email: string; action: string; name: string } | null {
  try {
    const saved = JSON.parse(storage.getItem(pendingKey) || 'null');
    if (!saved || typeof saved.savedAt !== 'number' || saved.savedAt > now || now - saved.savedAt > 3600000 ||
      typeof saved.email !== 'string' || !['login', 'join', 'post', 'apply', 'alerts'].includes(saved.action) ||
      (email && saved.email !== email.trim().toLowerCase())) return null;
    return { email: saved.email, action: saved.action, name: typeof saved.name === 'string' ? saved.name : '' };
  } catch { return null; }
}

export function clearPendingSignIn(storage: Storage) { storage.removeItem(pendingKey); }

export function requestPayload(fields: Record<string, string>) {
  const values = Object.fromEntries(draftFields.map(key => [key, (fields[key] || '').trim()]));
  if (!values.requester_name || values.requester_name.length > 80) throw new Error('Add your public name (up to 80 characters).');
  if (values.title.length < 5 || values.title.length > 100) throw new Error('Use 5–100 characters for the request title.');
  if (values.description.length < 40 || values.description.length > 1200) throw new Error('Describe the outcome in 40–1,200 characters.');
  if (!['Daily', 'Weekly', 'Monthly'].includes(values.frequency)) throw new Error('Choose how often your agent should work.');
  const budget = Number(values.budget);
  if (!values.budget || !Number.isFinite(budget) || budget < 1 || budget > 1000000 || Math.abs(budget * 100 - Math.round(budget * 100)) > 0.000001) throw new Error('Enter a monthly budget of at least $1, with up to two decimal places.');
  return { ...values, budget };
}

export function saveRequestDraft(storage: Storage, fields: Record<string, string>, now = Date.now()) {
  const values = Object.fromEntries(draftFields.filter(key => typeof fields[key] === 'string').map(key => [key, fields[key]]));
  storage.setItem(draftKey, JSON.stringify({ savedAt: now, values }));
}

export function readRequestDraft(storage: Storage, now = Date.now()): Record<string, string> {
  try {
    const saved = JSON.parse(storage.getItem(draftKey) || 'null');
    if (!saved || typeof saved.savedAt !== 'number' || saved.savedAt > now || now - saved.savedAt > 86400000 || !saved.values || typeof saved.values !== 'object') {
      storage.removeItem(draftKey);
      return {};
    }
    return Object.fromEntries(draftFields.filter(key => typeof saved.values[key] === 'string').map(key => [key, saved.values[key]]));
  } catch { return {}; }
}

export function clearRequestDraft(storage: Storage) {
  storage.removeItem(draftKey);
}

export function emailSignInOptions(origin: string, search: string, role?: string, name?: string) {
  const current = new URLSearchParams(search);
  const query = new URLSearchParams();
  const action = current.get('action');
  if (action && ['login', 'join', 'post', 'apply', 'alerts'].includes(action)) query.set('action', action);
  if (action === 'apply' && current.get('job')) query.set('job', current.get('job')!);
  return {
    emailRedirectTo: `${origin}/?${query}`,
    shouldCreateUser: true,
    ...(role ? { data: { evolution_role: role, evolution_name: name } } : {}),
  };
}

export function signInCallbackError(search: string, hash: string) {
  const params = [new URLSearchParams(search), new URLSearchParams(hash.replace(/^#/, ''))];
  if (!params.some(query => query.has('error') || query.has('error_code'))) return '';
  return 'This sign-in link has expired or was already used. Enter your email below to request a new link.';
}
