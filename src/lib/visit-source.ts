/**
 * Remembers where a website visitor came from (?utm_source=instagram&utm_campaign=laser-nov, or Facebook/Google
 * click IDs) for this browser session, so contact-form leads and online bookings get the right source.
 * Browser only.
 */
const KEY = 'cp_visit_source';

export function sourceFromParams(p: URLSearchParams): { source: string; detail: string | null } | null {
  const u = (p.get('utm_source') || p.get('source') || p.get('ref') || '').toLowerCase();
  const detail = p.get('utm_campaign') || p.get('campaign') || null;
  const map: [RegExp, string][] = [[/insta|^ig$/, 'instagram'], [/facebook|^fb$|meta/, 'facebook'], [/google|gads|adwords/, 'google'], [/whatsapp|^wa$/, 'whatsapp']];
  for (const [re, s] of map) if (re.test(u)) return { source: s, detail };
  if (p.get('fbclid')) return { source: 'facebook', detail };
  if (p.get('gclid') || p.get('gbraid') || p.get('wbraid')) return { source: 'google', detail };
  if (u) return { source: 'other', detail: detail || u };
  return null;
}

export function rememberVisitSource() {
  try {
    const s = sourceFromParams(new URLSearchParams(window.location.search));
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage blocked */ }
}

export function visitSource(): { source: string; detail: string | null } | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}
