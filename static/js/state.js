/** App state + lightweight pub/sub. */

const listeners = new Set();

export const state = {
  meta: { secure: true, listen: '', publicOrigin: location.origin },
  services: [],
  query: '',
  filter: 'all', // all | live | off
  openRow: null,
  toast: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function filteredServices() {
  const q = state.query.trim().toLowerCase();
  return state.services.filter((s) => {
    if (state.filter === 'live' && !s.enabled) return false;
    if (state.filter === 'off' && s.enabled) return false;
    if (!q) return true;
    return s.name.includes(q) || (s.url || '').toLowerCase().includes(q);
  });
}

export function counts() {
  const all = state.services.length;
  const live = state.services.filter((s) => s.enabled).length;
  return { all, live, off: all - live };
}
