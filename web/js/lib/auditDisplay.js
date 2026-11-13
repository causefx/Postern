export function auditServices(entries) {
  const names = new Set();
  for (const ev of entries || []) {
    if (ev.service) names.add(ev.service);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const text = (s) => ({ text: s });
const name = (s) => ({ text: s, strong: true });

/**
 * The row title as parts: plain verb text, and entity names (service, token) marked strong.
 * Returns [{ text, strong? }].
 */
export function auditTitle(ev) {
  const svc = ev.service ? [name(ev.service)] : [];
  const token = name(ev.token || 'caller');
  switch (ev.action) {
    case 'update':
      return ev.from ? [text('Renamed '), name(ev.from), text(' to '), ...svc] : [text('Updated '), ...svc];
    case 'rotate':
      return [text('Rotated the '), token, text(' token for '), ...svc];
    case 'token_add':
      return [text('Added the '), token, text(' token for '), ...svc];
    case 'token_revoke':
      return [text('Revoked the '), token, text(' token for '), ...svc];
    case 'token_pause':
      return [text(ev.paused ? 'Paused the ' : 'Resumed the '), token, text(' token for '), ...svc];
    case 'token_expiry':
      if (!ev.expires) return [text('Removed the expiry on the '), token, text(' token for '), ...svc];
      return [
        text('Set the '),
        token,
        text(` token to expire ${new Date(ev.expires).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} for `),
        ...svc,
      ];
    case 'token_scope':
      if (!ev.scope) return [text('Removed the scope on the '), token, text(' token for '), ...svc];
      return [text('Limited the '), token, text(' token for '), ...svc];
    case 'create':
      return [text('Created '), ...svc];
    case 'delete':
      return [text('Deleted '), ...svc];
    case 'enable':
      return [text(ev.enabled ? 'Turned on ' : 'Turned off '), ...svc];
    case 'duplicate':
      return ev.from ? [text('Duplicated '), name(ev.from), text(' as '), ...svc] : [text('Duplicated '), ...svc];
    case 'settings':
      return [text('Changed settings')];
    default:
      return [text(ev.action ? `${ev.action} ` : 'Changed '), ...svc];
  }
}

const KNOWN_ACTIONS = new Set([
  'update',
  'rotate',
  'token_add',
  'token_revoke',
  'token_pause',
  'token_expiry',
  'token_scope',
  'create',
  'delete',
  'enable',
  'duplicate',
  'settings',
]);

const BASE_FIELDS = new Set(['time', 'action', 'service']);

/** The extra fields of an entry, one short string each, shown as chips. Empty when there are none. */
export function auditChips(ev) {
  if (ev.action === 'settings') {
    const bits = [];
    if (ev.rate != null) bits.push(ev.rate === 0 ? 'rate off' : `rate ${ev.rate}`);
    if (ev.activity != null) bits.push(`activity ${ev.activity}`);
    if (ev.audit != null) bits.push(`audit ${ev.audit}`);
    if (ev.passwordLogin != null) bits.push(ev.passwordLogin ? 'password on' : 'password off');
    if (ev.embed != null) bits.push(`embedding ${ev.embed}`);
    return bits;
  }
  if (!KNOWN_ACTIONS.has(ev.action)) {
    return Object.entries(ev)
      .filter(([key, value]) => !BASE_FIELDS.has(key) && value != null && value !== '')
      .map(([key, value]) => `${key} ${value}`);
  }
  if (ev.action === 'token_scope') return ev.scope ? [ev.scope] : [];
  return ev.url ? [`url → ${ev.url}`] : [];
}

/** Icon name and tint for an entry. tone: 'success' | 'warning' | 'off' | 'neutral'. */
export function auditIcon(ev) {
  switch (ev.action) {
    case 'enable':
      return { icon: 'power', tone: ev.enabled ? 'success' : 'off' };
    case 'token_pause':
      return ev.paused ? { icon: 'pause', tone: 'warning' } : { icon: 'play', tone: 'success' };
    case 'update':
      return { icon: 'pencil', tone: 'neutral' };
    case 'rotate':
      return { icon: 'rotate', tone: 'neutral' };
    case 'delete':
    case 'token_revoke':
      return { icon: 'trash', tone: 'neutral' };
    case 'token_expiry':
      return { icon: 'clock', tone: 'neutral' };
    case 'token_scope':
      return { icon: 'lock', tone: 'neutral' };
    case 'create':
    case 'token_add':
      return { icon: 'plus', tone: 'neutral' };
    case 'duplicate':
      return { icon: 'copy', tone: 'neutral' };
    case 'settings':
      return { icon: 'gear', tone: 'neutral' };
    default:
      return { icon: 'dot', tone: 'neutral' };
  }
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole calendar days between t and now (0 = today). */
function daysAgo(t, now) {
  return Math.round((startOfDay(now) - startOfDay(t)) / 86400000);
}

/** Local calendar date of an entry, used to group rows into one card per day. */
export function auditDayKey(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'unknown';
  return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
}

/** Day heading: "Today", "Yesterday", or "Nov 10 · 2 days ago". The stylesheet upper-cases it. */
export function auditDayLabel(iso, now = new Date()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'Earlier';
  const diff = daysAgo(t, now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const date = t.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date} · ${diff} days ago`;
}

/** Time of day for a row, e.g. "4:43 PM". */
export function auditClock(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Full local timestamp for the row tooltip. */
export function auditFullTime(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function agoLabel(ms) {
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} ${day === 1 ? 'day' : 'days'} ago`;
}
