import { isAuthNone } from './authPresets.js';

const MASK = '••••••••';

export function authLabel(auth) {
  if (isAuthNone(auth)) return 'None';
  const parts = [];
  if (auth.header) parts.push(`Header ${auth.header.name || 'X-Api-Key'}`);
  if (auth.query) parts.push(`Query ${auth.query.name || 'apikey'}`);
  if (auth.authz?.kind === 'basic') parts.push(`Basic ${auth.authz.username || '<username>'}`);
  else if (auth.authz) parts.push('Bearer Authorization');
  return parts.join(' + ') || 'None';
}

export function authMethodShort(auth) {
  if (isAuthNone(auth)) return 'credential';
  const parts = [];
  if (auth.header) parts.push(`${auth.header.name || 'X-Api-Key'} header`);
  if (auth.query) parts.push(`${auth.query.name || 'apikey'} query param`);
  if (auth.authz?.kind === 'basic') parts.push('Basic auth');
  else if (auth.authz) parts.push('Bearer token');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return parts.slice(0, -1).join(', ') + ', or ' + parts[parts.length - 1];
}

/** Masked "what Postern sends upstream" preview text. */
export function authPreview(auth, { url = '' } = {}) {
  const host = url ? shortenURL(url) : '…';
  if (isAuthNone(auth)) {
    return `GET ${host}/..\n(nothing added — the service needs no credentials)`;
  }
  const lines = [];
  let getLine = `GET ${host}/..`;
  if (auth.query) {
    getLine = `GET ${host}/..?${auth.query.name || 'apikey'}=${MASK}`;
  }
  lines.push(getLine);
  if (auth.header) {
    lines.push(`${auth.header.name || 'X-Api-Key'}: ${MASK}`);
  }
  if (auth.authz?.kind === 'basic') {
    lines.push(`Authorization: Basic ${MASK}`);
  } else if (auth.authz) {
    lines.push(`Authorization: Bearer ${MASK}`);
  }
  return lines.join('\n');
}

/** Preview of what callers send to Postern for access=upstream. */
export function callerPreview(auth, { publicBase = '' } = {}) {
  const base = publicBase ? shortenURL(publicBase) : 'http://localhost:8080/p/<name>/';
  if (isAuthNone(auth)) {
    return `GET ${base}..`;
  }
  const opts = [];
  if (auth.header) {
    opts.push(`  ${auth.header.name || 'X-Api-Key'}: pst_****`);
  }
  if (auth.query) {
    opts.push(`  ?${auth.query.name || 'apikey'}=pst_****`);
  }
  if (auth.authz?.kind === 'basic') {
    opts.push(`  Authorization: Basic ${auth.authz.username || 'user'}:pst_****`);
  } else if (auth.authz) {
    opts.push(`  Authorization: Bearer pst_****`);
  }
  return `GET ${base}..\nany one of:\n${opts.join('\n')}\n(or the real value in the same place)`;
}

export function secureTxt(auth) {
  if (isAuthNone(auth)) {
    return 'The upstream needs no credentials. Postern still requires the caller token on every request.';
  }
  return 'Values are stored on this server only. Postern clears anything a caller puts in these places and adds the real values.';
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

function shortenURL(u) {
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.host}/..`;
  } catch {
    return u;
  }
}
