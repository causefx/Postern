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

/**
 * The rows of the settings list, in the order they are shown. `kind` is 'action' for a row that opens
 * its own screen, 'info' for a read-only fact, 'about' for the version row, and otherwise a setting
 * that expands in place and is saved with the Save button.
 */
export const SETTING_DEFS = [
  {
    id: 'rate',
    icon: 'gauge',
    group: 'traffic',
    groupLabel: 'Traffic',
    title: 'Rate limit',
    hint: 'Max requests per caller before Postern answers 429',
    keywords: 'settings.rateLimit requests minute',
  },
  {
    id: 'activity',
    icon: 'pulse',
    group: 'activity',
    groupLabel: 'Logs',
    title: 'Request log',
    hint: 'Proxied requests kept per service',
    keywords: 'settings.activityLimit entries history requests traffic proxy activity',
  },
  {
    id: 'audit',
    icon: 'history',
    group: 'activity',
    groupLabel: 'Logs',
    title: 'Admin log',
    hint: 'Edits, token changes and settings',
    keywords: 'settings.auditLimit entries history audit changes admin',
  },
  {
    id: 'password',
    icon: 'key',
    group: 'security',
    groupLabel: 'Security',
    title: 'Admin password',
    hint: 'Allow signing in with the admin password',
    keywords: 'settings.passwordLogin oidc sso sign in login',
  },
  {
    id: 'embed',
    icon: 'frame',
    group: 'security',
    groupLabel: 'Security',
    title: 'Embedding',
    hint: 'Let a dashboard show the admin UI in a frame',
    keywords: 'settings.embedOrigins iframe frame embed dashboard organizr homepage heimdall frame-ancestors clickjacking',
  },
  {
    id: 'storage',
    kind: 'info',
    icon: 'lock',
    group: 'security',
    groupLabel: 'Security',
    title: 'Stored data',
    hint: '',
    keywords: 'encrypted encryption at rest POSTERN_KEY POSTERN_KEY_FILE keys tokens secrets data file',
  },
  {
    id: 'export',
    kind: 'action',
    icon: 'download',
    group: 'backup',
    groupLabel: 'Backup',
    title: 'Export config',
    hint: 'Download services as JSON',
    keywords: 'backup export download save copy json redacted full secrets keys git',
  },
  {
    id: 'import',
    kind: 'action',
    icon: 'upload',
    group: 'backup',
    groupLabel: 'Backup',
    title: 'Import config',
    hint: 'Validate and add services from a file',
    keywords: 'backup import restore upload load json dry run overwrite migrate',
  },
  {
    id: 'version',
    kind: 'about',
    icon: 'cube',
    group: 'about',
    groupLabel: 'About',
    title: 'Version',
    hint: '',
    keywords: 'version update upgrade release latest available changelog',
  },
];

/** The group chips above the list: [id, label]. */
export const SETTING_GROUPS = [
  ['all', 'All'],
  ['traffic', 'Traffic'],
  ['activity', 'Logs'],
  ['security', 'Security'],
  ['backup', 'Backup'],
  ['about', 'About'],
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

// Summaries are small descriptions of what a row shows on its right (see SettingsRow.js):
// { value, unit } a number with a unit, { dot, text } a status, { text, tone } a plain label,
// { pill } a highlighted tag.
export function rateSummary(n) {
  if (!n) return { text: 'Off' };
  return { value: String(n), unit: 'req/min' };
}

export function activitySummary(n) {
  return { value: String(n), unit: n === 1 ? 'entry' : 'entries' };
}

export function passwordSummary(on) {
  return { dot: on ? 'on' : 'off', text: on ? 'On' : 'Off' };
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
  if (!list.length) return { dot: 'off', text: 'Off' };
  if (list.includes('*')) return { dot: 'warn', text: 'Any site' };
  return { dot: 'on', text: list.length === 1 ? '1 site' : `${list.length} sites` };
}

export function storageSummary(encrypted) {
  return encrypted ? { dot: 'on', text: 'Encrypted' } : { text: 'Not encrypted', tone: 'warn' };
}

/** The Version row's right side, from the server's update status. */
export function versionSummary(update) {
  if (update?.enabled === false) return { text: update.reason === 'dev' ? 'Dev build' : 'Checks off' };
  if (update?.available) return { pill: `v${update.latest} available` };
  if (update?.latest) return { text: 'Up to date' };
  return null;
}

export function sameList(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
