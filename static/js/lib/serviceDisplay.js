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

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
}
