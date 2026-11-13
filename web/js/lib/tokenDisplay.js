/** 'expired' | 'paused' | 'active'. The server decides expired, not the browser clock. */
export function tokenState(t) {
  if (t?.expired) return 'expired';
  if (t?.paused) return 'paused';
  return 'active';
}

function shortDate(d, now) {
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "Expires in 3 days", "Expires Mar 4", "Expired Nov 12", or '' when it never expires. */
export function expiryLabel(t, now = new Date()) {
  if (!t?.expiresAt) return '';
  const at = new Date(t.expiresAt);
  if (Number.isNaN(at.getTime())) return '';
  if (t.expired) return `Expired ${shortDate(at, now)}`;
  const hours = (at - now) / 3600000;
  if (hours < 1) return 'Expires in under an hour';
  if (hours < 48) return `Expires in ${Math.round(hours)} hr`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `Expires in ${days} days`;
  return `Expires ${shortDate(at, now)}`;
}

/** Local YYYY-MM-DD for a date input, `days` from today. */
export function dateInputValue(days = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** RFC 3339 instant for the end of a local YYYY-MM-DD day, or '' if it is not a date. */
export function endOfDayISO(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** The local YYYY-MM-DD of an existing expiry, to prefill the editor. */
export function expiryDateValue(t) {
  if (!t?.expiresAt) return '';
  const d = new Date(t.expiresAt);
  return Number.isNaN(d.getTime()) ? '' : dateInputValue(0, d);
}

/** HTTP methods a scope can name, in the order the server stores them. */
export const SCOPE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** The "Read only" preset. */
export const READ_ONLY_METHODS = ['GET', 'HEAD'];

/** True when the token has a scope that restricts something. */
export function isScoped(t) {
  const s = t?.scope;
  return !!s && ((s.methods?.length || 0) + (s.paths?.length || 0)) > 0;
}

/** "Full access", or what the scope allows: "GET, HEAD · 2 paths", "Any method · 1 path". */
export function scopeLabel(t) {
  if (!isScoped(t)) return 'Full access';
  const { methods = [], paths = [] } = t.scope;
  const m = methods.length ? methods.join(', ') : 'Any method';
  const p = !paths.length ? 'any path' : paths.length === 1 ? '1 path' : `${paths.length} paths`;
  return `${m} · ${p}`;
}

/** Short "last used" for a token row: "just now", "2h ago", "3d ago", or "Never used". */
export function lastUsedShort(t, now = new Date()) {
  if (!t?.lastUsedAt) return 'Never used';
  const at = new Date(t.lastUsedAt);
  if (Number.isNaN(at.getTime())) return 'Never used';
  const min = Math.floor(Math.max(0, now - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Time left before expiry as { text: "30d", soon }, or null when there is none or it has passed. */
export function expiryShort(t, now = new Date()) {
  if (!t?.expiresAt || t.expired) return null;
  const at = new Date(t.expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  const ms = at - now;
  if (ms <= 0) return null;
  const hours = ms / 3600000;
  let text;
  if (hours < 1) text = '<1h';
  else if (hours < 24) text = `${Math.floor(hours)}h`;
  else text = `${Math.ceil(hours / 24)}d`;
  return { text, soon: ms < 7 * 86400000 };
}
