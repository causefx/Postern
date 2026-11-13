export const DEFAULT_RATE_LIMIT = 120;
export const DEFAULT_ACTIVITY_LIMIT = 20;
export const DEFAULT_AUDIT_LIMIT = 100;
export const MAX_RATE_LIMIT = 10000;
export const MAX_ACTIVITY_LIMIT = 1000;
export const MAX_AUDIT_LIMIT = 5000;

export const RATE_PRESETS = [
  { value: 0, label: 'Off' },
  { value: 60, label: '60' },
  { value: 120, label: '120' },
  { value: 300, label: '300' },
  { value: 600, label: '600' },
];

export const ACTIVITY_PRESETS = [
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 500, label: '500' },
];

export const AUDIT_PRESETS = [
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 250, label: '250' },
  { value: 500, label: '500' },
];

export const SETTING_DEFS = [
  {
    id: 'rate',
    group: 'traffic',
    groupLabel: 'Traffic',
    title: 'Rate limit',
    hint: 'Max requests per caller before Postern answers 429',
    keywords: 'settings.rateLimit requests minute',
  },
  {
    id: 'activity',
    group: 'activity',
    groupLabel: 'Logs',
    title: 'Request log',
    hint: 'How many proxied requests to keep per service',
    keywords: 'settings.activityLimit entries history requests traffic proxy activity',
  },
  {
    id: 'audit',
    group: 'activity',
    groupLabel: 'Logs',
    title: 'Admin log',
    hint: 'How many admin changes to keep, such as edits, token changes and settings',
    keywords: 'settings.auditLimit entries history audit changes admin',
  },
  {
    id: 'embed',
    group: 'security',
    groupLabel: 'Security',
    title: 'Embedding',
    hint: 'Let a dashboard show the admin UI in a frame',
    keywords: 'settings.embedOrigins iframe frame embed dashboard organizr homepage heimdall frame-ancestors clickjacking',
  },
  {
    id: 'password',
    group: 'signin',
    groupLabel: 'Sign-in',
    title: 'Admin password',
    hint: 'Allow signing in with the admin password',
    keywords: 'settings.passwordLogin oidc sso',
  },
];

export function clampRate(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(MAX_RATE_LIMIT, v);
}

export function clampActivity(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(MAX_ACTIVITY_LIMIT, v);
}

export function clampAudit(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_AUDIT_LIMIT;
  if (v < 1) return 1;
  return Math.min(MAX_AUDIT_LIMIT, v);
}

export function rateSummary(n) {
  if (!n) return 'Off';
  return `${n} req / min`;
}

export function activitySummary(n) {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

export function passwordSummary(on) {
  return on ? 'On' : 'Off';
}

export function perSecondLabel(n) {
  if (!n) return 'No limit, per caller';
  const per = n / 60;
  const rounded = Math.round(per * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `≈ ${text} per second, per caller`;
}

export function settingVisible(query, def) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${def.title} ${def.hint} ${def.keywords}`.toLowerCase().includes(q);
}

const MAX_EMBED_ORIGINS = 10;

// The same rules as the server (frame.go): a scheme, a host with an optional "*." wildcard, an
// optional port, nothing else. The server checks again; this only gives an answer while typing.
const EMBED_SITE = /^https?:\/\/(?:(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** Splits the text on newlines, commas and spaces into a clean, de-duplicated list. */
export function parseEmbedOrigins(text) {
  const origins = [];
  for (const raw of String(text || '').split(/[\s,]+/)) {
    const entry = raw.replace(/\/+$/, '');
    if (!entry) continue;
    if (entry !== '*' && !EMBED_SITE.test(entry)) {
      return {
        origins: [],
        error: `${JSON.stringify(raw)} is not a site like https://dash.example.com (scheme, host, optional port, no path)`,
      };
    }
    const clean = entry === '*' ? '*' : entry.toLowerCase();
    if (!origins.includes(clean)) origins.push(clean);
  }
  if (origins.length > MAX_EMBED_ORIGINS) return { origins: [], error: `At most ${MAX_EMBED_ORIGINS} sites` };
  return { origins, error: '' };
}

export function embedSummary(origins) {
  const list = origins || [];
  if (!list.length) return 'Off';
  if (list.includes('*')) return 'Any site';
  return list.length === 1 ? '1 site' : `${list.length} sites`;
}

export function sameList(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
