/** App state + lightweight pub/sub. */

const listeners = new Set();

export const state = {
  meta: { secure: true, listen: '', publicOrigin: location.origin },
  /** Result of the server's update check; null until first loaded. See GET /admin/api/update. */
  update: null,
  services: [],
  filter: 'all', // all | live | off
  selected: [], // service names
  focusIndex: -1,
  commandOpen: false,
  drawer: null, // { mode: 'create'|'edit', name?: string }
  drawerDirty: false,
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
  return state.services
    .filter((s) => {
      if (state.filter === 'live' && !s.enabled) return false;
      if (state.filter === 'off' && s.enabled) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function counts() {
  const all = state.services.length;
  const live = state.services.filter((s) => s.enabled).length;
  return { all, live, off: all - live };
}

export function isSelected(name) {
  return state.selected.includes(name);
}

export function toggleSelect(name) {
  const set = new Set(state.selected);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  setState({ selected: [...set] });
}

export function setSelected(names) {
  setState({ selected: [...new Set(names)] });
}

export function clearSelection() {
  setState({ selected: [] });
}

export function focusedService() {
  const items = filteredServices();
  if (state.focusIndex < 0 || state.focusIndex >= items.length) return null;
  return items[state.focusIndex];
}

export function setFocusIndex(i) {
  const n = filteredServices().length;
  if (n === 0) {
    setState({ focusIndex: -1 });
    return;
  }
  const next = ((i % n) + n) % n;
  setState({ focusIndex: next });
}

export function clampFocus() {
  const n = filteredServices().length;
  if (n === 0) {
    if (state.focusIndex !== -1) setState({ focusIndex: -1 });
    return;
  }
  if (state.focusIndex >= n) setState({ focusIndex: n - 1 });
}

/** Drop selection entries that no longer exist. */
export function pruneSelection() {
  const names = new Set(state.services.map((s) => s.name));
  const next = state.selected.filter((n) => names.has(n));
  if (next.length !== state.selected.length) setState({ selected: next });
}

/** Mutate focus/selection without notifying — safe to call inside render. */
export function syncListState() {
  const names = new Set(state.services.map((s) => s.name));
  state.selected = state.selected.filter((n) => names.has(n));
  const n = filteredServices().length;
  if (n === 0) state.focusIndex = -1;
  else if (state.focusIndex >= n) state.focusIndex = n - 1;
}
