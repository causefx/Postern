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

export function recentTitle(service) {
  if (!service?.lastSeen) return 'No requests yet';
  return `Last request ${service.lastSeen}${service.lastWho ? ` · ${service.lastWho}` : ''}`;
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
}
