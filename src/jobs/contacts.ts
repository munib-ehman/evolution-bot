export type ContactFields = { contact_email?: string | null; contact_linkedin?: string | null; contact_x?: string | null; contact_url?: string | null };
type ContactKind = keyof ContactFields;

export function contactHref(kind: ContactKind, value: string | null | undefined): string | null {
  const input = value?.trim();
  if (!input || /[\r\n]/.test(input)) return null;
  if (kind === 'contact_email') return /^[A-Za-z0-9._%+!-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(input) && input.length <= 254 ? `mailto:${encodeURIComponent(input)}` : null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || input.length > 500) return null;
    if (kind === 'contact_linkedin') {
      if (!['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || !/^\/(in|company)\/[A-Za-z0-9%_-]+\/?$/.test(url.pathname)) return null;
      url.search = ''; url.hash = '';
    } else if (kind === 'contact_x') {
      if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname) || /^\/(home|login|settings|messages|search|explore)\/?$/i.test(url.pathname)) return null;
      url.search = ''; url.hash = '';
    } else if (!/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$/.test(url.hostname) || /\.(local|localhost|internal)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

const contactNames: [ContactKind, string][] = [['contact_email', 'Email'], ['contact_linkedin', 'LinkedIn'], ['contact_x', 'X'], ['contact_url', 'Contact page']];

export function requestContacts(fields: ContactFields) {
  return contactNames.flatMap(([kind, label]) => {
    const href = contactHref(kind, fields[kind]);
    return href ? [{ kind, label, href, external: kind !== 'contact_email' }] : [];
  });
}

export function validateContacts(fields: ContactFields) {
  const normalized: ContactFields = {};
  for (const [kind, label] of contactNames) {
    const value = fields[kind]?.trim();
    if (!value) continue;
    const href = contactHref(kind, value);
    if (!href) throw new Error(`Enter a valid ${label === 'Email' ? 'contact email' : `${label} link`}.`);
    normalized[kind] = kind === 'contact_email' ? value.toLowerCase() : href;
  }
  if (!requestContacts(normalized).length) throw new Error('Add at least one public contact method.');
  return normalized;
}
