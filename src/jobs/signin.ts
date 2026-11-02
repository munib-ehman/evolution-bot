const draftKey = 'evolution:request-draft:v2';
const draftFields = ['requester_name', 'title', 'description', 'frequency', 'budget', 'email', 'contact_email', 'contact_linkedin', 'contact_x', 'contact_url'];

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
