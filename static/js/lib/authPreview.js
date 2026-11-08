const MASK = '••••••••';

export function authLabel(auth) {
  if (!auth || auth.type === 'none') return 'None';
  if (auth.type === 'header') return `Header ${auth.name || 'X-Api-Key'}`;
  if (auth.type === 'query') return `Query ${auth.name || 'apikey'}`;
  if (auth.type === 'bearer') return 'Bearer Authorization';
  if (auth.type === 'basic') return `Basic ${auth.username || '<username>'}`;
  return 'None';
}

export function authMethodShort(auth) {
  if (!auth || auth.type === 'none') return 'credential';
  if (auth.type === 'header') return `${auth.name || 'X-Api-Key'} header`;
  if (auth.type === 'query') return `${auth.name || 'apikey'} query param`;
  if (auth.type === 'bearer') return 'Bearer token';
  if (auth.type === 'basic') return 'Basic auth';
  return 'credential';
}

/** Masked "what Postern sends upstream" preview text. */
export function authPreview(auth, { url = '' } = {}) {
  const a = auth || { type: 'none' };
  const host = url ? shortenURL(url) : '…';
  switch (a.type) {
    case 'header':
      return `GET ${host}/..\n${a.name || 'X-Api-Key'}: ${MASK}`;
    case 'query':
      return `GET ${host}/..?${a.name || 'apikey'}=${MASK}`;
    case 'bearer':
      return `GET ${host}/..\nAuthorization: Bearer ${MASK}`;
    case 'basic':
      return `GET ${host}/..\nAuthorization: Basic ${MASK}`;
    default:
      return `GET ${host}/..\n(no upstream credentials)`;
  }
}

/** Preview of what callers send to Postern for access=upstream. */
export function callerPreview(auth, { publicBase = '' } = {}) {
  const a = auth || { type: 'none' };
  const base = publicBase ? shortenURL(publicBase) : 'http://localhost:8080/p/<name>/';
  switch (a.type) {
    case 'header':
      return `GET ${base}..\n${a.name || 'X-Api-Key'}: pst_**** — or the real key`;
    case 'query':
      return `GET ${base}..?${a.name || 'apikey'}=pst_**** — or the real key`;
    case 'bearer':
      return `GET ${base}..\nAuthorization: Bearer pst_**** — or the real key`;
    case 'basic':
      return `GET ${base}..\nAuthorization: Basic ${a.username || 'user'}:pst_**** — or the real password`;
    default:
      return `GET ${base}..`;
  }
}

export function secureTxt(auth) {
  const a = auth || { type: 'none' };
  switch (a.type) {
    case 'header':
      return `Stored on this server only. Postern removes any ${a.name || 'X-Api-Key'} a caller sends and adds the real one.`;
    case 'query':
      return `Stored on this server only. Postern removes any ${a.name || 'apikey'} query param a caller sends and adds the real one.`;
    case 'bearer':
      return 'Stored on this server only. Postern replaces Authorization with the stored Bearer token.';
    case 'basic':
      return 'Stored on this server only. Postern replaces Authorization with the stored Basic credentials.';
    default:
      return 'The upstream needs no credentials. Postern still requires the caller token on every request.';
  }
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

function shortenURL(u) {
  try {
    const parsed = new URL(u);
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''));
  } catch {
    return String(u).replace(/\/$/, '');
  }
}
