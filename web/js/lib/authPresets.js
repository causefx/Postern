/**
 * The upstream credential slots in the drawer: one header, one URL parameter and one Authorization
 * header, each optional. An app's `auth` (from apps/<id>/app.json) says which of them it takes:
 * { header?: 'X-Api-Key', query?: 'apikey', authz?: 'bearer' | 'basic' }.
 */

export function emptyAuth() {
  return { header: null, query: null, authz: null };
}

/**
 * The ways an app takes its key that `auth` does not have yet, as { header?, query?, authz? }.
 * Header names compare without case, as HTTP does. Empty when `auth` already has them all.
 */
export function missingAppAuth(auth, appAuth) {
  const missing = {};
  if (!appAuth) return missing;
  if (appAuth.header && (auth.header?.name || '').toLowerCase() !== appAuth.header.toLowerCase()) {
    missing.header = appAuth.header;
  }
  if (appAuth.query && (auth.query?.name || '') !== appAuth.query) missing.query = appAuth.query;
  if (appAuth.authz && auth.authz?.kind !== appAuth.authz) missing.authz = appAuth.authz;
  return missing;
}

/**
 * Add each way an app takes its key to `auth`, in place. A slot that is already there keeps the
 * value typed into it, and whether one is stored; slots the app does not use are left alone.
 */
export function addAppAuth(auth, appAuth) {
  if (!appAuth) return;
  if (appAuth.header) {
    auth.header = { name: appAuth.header, secret: auth.header?.secret || '', stored: !!auth.header?.stored };
  }
  if (appAuth.query) {
    auth.query = { name: appAuth.query, secret: auth.query?.secret || '', stored: !!auth.query?.stored };
  }
  if (appAuth.authz) {
    const kind = appAuth.authz === 'basic' ? 'basic' : 'bearer';
    auth.authz = {
      kind,
      username: kind === 'basic' ? auth.authz?.username || '' : '',
      secret: auth.authz?.secret || '',
      stored: !!auth.authz?.stored,
    };
  }
}

/** "the X-Api-Key header or ?apikey": how an app takes its key, for a sentence. */
export function describeAppAuth(appAuth, { joiner = ' or ' } = {}) {
  const parts = [];
  if (appAuth?.header) parts.push(`the ${appAuth.header} header`);
  if (appAuth?.query) parts.push(`?${appAuth.query}`);
  if (appAuth?.authz) parts.push(appAuth.authz === 'basic' ? 'a Basic sign-in' : 'a Bearer token');
  return parts.join(joiner);
}

/** "an X-Api-Key header and an apikey URL parameter": the slots Set up adds, for a sentence. */
export function describeAddedSlots(missing) {
  const parts = [];
  if (missing.header) parts.push(`${article(missing.header)} ${missing.header} header`);
  if (missing.query) parts.push(`${article(missing.query)} ${missing.query} URL parameter`);
  if (missing.authz) parts.push(missing.authz === 'basic' ? 'a Basic sign-in' : 'a Bearer token');
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function article(word) {
  // "an X-Api-Key", "an apikey", "a Token": by how the name is read aloud, roughly.
  return /^[aeiouxAEIOUX]/.test(word) ? 'an' : 'a';
}

export function authFromView(view) {
  const a = view || {};
  return {
    header: a.header ? { name: a.header.name || 'X-Api-Key', secret: '', stored: !!a.header.hasSecret } : null,
    query: a.query ? { name: a.query.name || 'apikey', secret: '', stored: !!a.query.hasSecret } : null,
    authz: a.authz
      ? {
          kind: a.authz.kind === 'basic' ? 'basic' : 'bearer',
          username: a.authz.username || '',
          secret: '',
          stored: !!a.authz.hasSecret,
        }
      : null,
  };
}

export function authToPayload(auth) {
  const out = {};
  if (auth.header) {
    out.header = {
      name: auth.header.name || 'X-Api-Key',
      secret: auth.header.secret || undefined,
    };
  }
  if (auth.query) {
    out.query = {
      name: auth.query.name || 'apikey',
      secret: auth.query.secret || undefined,
    };
  }
  if (auth.authz) {
    out.authz = {
      kind: auth.authz.kind === 'basic' ? 'basic' : 'bearer',
      username: auth.authz.kind === 'basic' ? auth.authz.username || undefined : undefined,
      secret: auth.authz.secret || undefined,
    };
  }
  return out;
}

export function isAuthNone(auth) {
  return !auth?.header && !auth?.query && !auth?.authz;
}
