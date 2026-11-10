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
    groupLabel: 'Activity',
    title: 'Activity history',
    hint: 'How many recent requests the activity log keeps',
    keywords: 'settings.activityLimit entries log',
  },
  {
    id: 'audit',
    group: 'activity',
    groupLabel: 'Activity',
    title: 'Audit log',
    hint: 'How many admin changes the activity list keeps',
    keywords: 'settings.auditLimit entries audit',
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
