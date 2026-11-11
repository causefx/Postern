import { isAuthNone } from './authPresets.js';

/** Short upstream host for table cells. */
export function upstreamHost(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.host + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '');
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

/** Compact cred labels for the UPSTREAM CREDS column. */
export function credBits(auth) {
  if (isAuthNone(auth)) return ['None'];
  const bits = [];
  if (auth.header) bits.push(auth.header.name || 'X-Api-Key');
  if (auth.query) bits.push(`?${auth.query.name || 'apikey'}`);
  if (auth.authz?.kind === 'basic') bits.push('Basic');
  else if (auth.authz) bits.push('Bearer');
  return bits.length ? bits : ['None'];
}

export function accessLabel(service) {
  return service.access === 'upstream' ? 'Same as service' : 'Postern token';
}

/** Compact "key · count · status · time" from the request ring. */
export function recentLabel(service) {
  if (!service || !service.requests) return '';
  const parts = [];
  if (service.lastWho) parts.push(service.lastWho);
  parts.push(String(service.requests));
  if (service.lastStatus) parts.push(String(service.lastStatus));
  if (service.lastSeen) {
    const when = new Date(service.lastSeen);
    if (!Number.isNaN(when.getTime())) {
      parts.push(when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  }
  return parts.join(' · ');
}

/** Match a recent request by token name, path, method, status, or pause reason. */
export function matchActivity(ev, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (!ev) return false;
  return [ev.who, ev.reason, ev.method, ev.path, String(ev.status ?? '')]
    .some((part) => String(part || '').toLowerCase().includes(q));
}

/** Status text class for request logs and docs legends. */
export function statusToneClass(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return 'status-tone-muted';
  if (n >= 200 && n < 300) return 'status-tone-ok';
  if (n >= 400 && n < 500) return 'status-tone-warn';
  if (n >= 500) return 'status-tone-err';
  return 'status-tone-muted';
}

/** Unique caller labels for quick filters, stable order. */
export function activityWhoFilters(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    const who = String(ev?.who || '').trim();
    if (!who || seen.has(who)) continue;
    seen.add(who);
    out.push(who);
  }
  return out;
}

/** Local date and time for one request, e.g. "Nov 10, 5:33:38 PM". */
export function requestWhen(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Clock time only, e.g. "11:03:10 PM". */
export function requestClock(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Group newest-first events into day cards.
 * Returns [{ key, label, kind: 'today'|'yesterday'|'older', events }]
 */
export function groupActivityByDay(events) {
  const now = new Date();
  const today = startOfLocalDay(now);
  const yesterday = today - 86400000;
  const buckets = new Map();

  for (const ev of events || []) {
    const when = new Date(ev.time);
    if (Number.isNaN(when.getTime())) continue;
    const day = startOfLocalDay(when);
    let key;
    let label;
    let kind;
    if (day === today) {
      key = 'today';
      label = 'Today';
      kind = 'today';
    } else if (day === yesterday) {
      key = 'yesterday';
      label = 'Yesterday';
      kind = 'yesterday';
    } else {
      key = `d-${day}`;
      label = when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      kind = 'older';
    }
    if (!buckets.has(key)) buckets.set(key, { key, label, kind, events: [] });
    buckets.get(key).events.push(ev);
  }

  const order = (a, b) => {
    if (a.kind === 'today') return -1;
    if (b.kind === 'today') return 1;
    if (a.kind === 'yesterday') return -1;
    if (b.kind === 'yesterday') return 1;
    return b.key.localeCompare(a.key);
  };
  return [...buckets.values()].sort(order);
}

/** Count 4xx/5xx events. */
export function activityErrorCount(events) {
  let n = 0;
  for (const ev of events || []) {
    const s = Number(ev.status);
    if (s >= 400) n += 1;
  }
  return n;
}

export function isActivityError(ev) {
  const s = Number(ev?.status);
  return Number.isFinite(s) && s >= 400;
}

export function recentTitle(service) {
  if (!service?.lastSeen) return 'No requests yet';
  return `Last request ${service.lastSeen}${service.lastWho ? ` · ${service.lastWho}` : ''}`;
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
}

/** Two-letter tile label from a service name, e.g. "sonarr" → "So". */
export function nameTile(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const a = s[0].toUpperCase();
  const b = (s[1] || '').toLowerCase();
  return a + b;
}
