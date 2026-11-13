import { agoLabel } from './auditDisplay.js';

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

/** "Used 2 hr ago" or "Never used". */
export function lastUsedLabel(t, now = new Date()) {
  if (!t?.lastUsedAt) return 'Never used';
  const at = new Date(t.lastUsedAt);
  if (Number.isNaN(at.getTime())) return 'Never used';
  return `Used ${agoLabel(now - at)}`;
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
