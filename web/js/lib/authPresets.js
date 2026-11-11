/** Presets enable one or more auth slots. */
export const AUTH_PRESETS = [
  {
    label: '*arr apps',
    auth: {
      header: { name: 'X-Api-Key', secret: '' },
      query: { name: 'apikey', secret: '' },
      authz: null,
    },
  },
  {
    label: 'Jellyfin',
    auth: {
      header: { name: 'X-Emby-Token', secret: '' },
      query: null,
      authz: null,
    },
  },
  {
    label: 'Plex',
    auth: {
      header: null,
      query: { name: 'X-Plex-Token', secret: '' },
      authz: null,
    },
  },
  {
    label: 'SABnzbd',
    auth: {
      header: null,
      query: { name: 'apikey', secret: '' },
      authz: null,
    },
  },
  {
    label: 'Home Assistant',
    auth: {
      header: null,
      query: null,
      authz: { kind: 'bearer', username: '', secret: '' },
    },
  },
];

export function emptyAuth() {
  return { header: null, query: null, authz: null };
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

export function presetMatches(auth, preset) {
  const p = preset.auth;
  const same = (a, b, key) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (key === 'authz') return a.kind === b.kind;
    return (a.name || '') === (b.name || '');
  };
  return same(auth.header, p.header) && same(auth.query, p.query) && same(auth.authz, p.authz, 'authz');
}
