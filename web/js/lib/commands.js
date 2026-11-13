import { api } from '../api.js';
import { state, setState, clearSelection, filteredServices, toggleSelect } from '../state.js';
import { copyServiceToken, toggleServiceEnabled, setManyEnabled } from './serviceActions.js';
import { openBulkRotateDialog } from '../components/dialogs/BulkRotateDialog.js';
import { openBulkDeleteDialog } from '../components/dialogs/BulkDeleteDialog.js';
import { openRotateDialog } from '../components/dialogs/RotateTokenDialog.js';
import { openDeleteDialog } from '../components/dialogs/DeleteServiceDialog.js';
import { openDuplicateDialog } from '../components/dialogs/DuplicateServiceDialog.js';

export const LIST_SHORTCUTS = [
  { keys: ['J', 'K'], label: 'move' },
  { keys: ['X'], label: 'select' },
  { keys: ['Space'], label: 'on/off' },
  { keys: ['C'], label: 'copy token' },
  { keys: ['Enter'], label: 'open' },
];

export const DRAWER_SHORTCUTS = [
  { keys: ['J', 'K'], label: 'prev / next' },
  { keys: ['Esc'], label: 'close' },
];

function matches(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

/**
 * Palette sections. Each item is { id, section, label, icon, danger?, run }.
 */
export function commandSections({ query = '', onAdd, onReload, onEdit, onSettings } = {}) {
  const sections = [];
  const selected = state.services.filter((s) => state.selected.includes(s.name));
  const names = selected.map((s) => s.name);
  const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

  if (selected.length) {
    const bulk = [];
    const anyLive = selected.some((s) => s.enabled);
    if (anyLive && matches(query, `turn off ${label}`)) {
      bulk.push({
        id: 'bulk-off',
        section: 'selected',
        label: `Turn off ${label}`,
        icon: 'off',
        run: async () => {
          await setManyEnabled(names, false);
        },
      });
    }
    if (selected.some((s) => !s.enabled) && matches(query, `turn on ${label}`)) {
      bulk.push({
        id: 'bulk-on',
        section: 'selected',
        label: `Turn on ${label}`,
        icon: 'on',
        run: async () => {
          await setManyEnabled(names, true);
        },
      });
    }
    if (matches(query, `rotate tokens for ${label}`)) {
      bulk.push({
        id: 'bulk-rotate',
        section: 'selected',
        label: `Rotate tokens for ${label}`,
        icon: 'rotate',
        run: () => openBulkRotateDialog({ names }),
      });
    }
    if (matches(query, `delete ${label}`)) {
      bulk.push({
        id: 'bulk-delete',
        section: 'selected',
        label: `Delete ${label}`,
        icon: 'close',
        danger: true,
        run: () => openBulkDeleteDialog({ names }),
      });
    }
    if (selected.length === 1 && matches(query, `duplicate ${selected[0].name}`)) {
      bulk.push({
        id: 'dup-selected',
        section: 'selected',
        label: `Duplicate ${selected[0].name}`,
        icon: 'copy',
        run: () => openDuplicateDialog({ service: selected[0], onDuplicated: () => onReload?.() }),
      });
    }
    if (matches(query, 'clear selection')) {
      bulk.push({
        id: 'clear',
        section: 'selected',
        label: 'Clear selection',
        icon: 'close',
        run: () => clearSelection(),
      });
    }
    if (bulk.length) sections.push({ id: 'selected', title: `Selected (${selected.length})`, items: bulk });
  }

  const actions = [];
  if (matches(query, 'add service')) {
    actions.push({ id: 'add', section: 'actions', label: 'Add service', icon: 'plus', run: () => onAdd?.() });
  }
  if (matches(query, 'settings')) {
    actions.push({ id: 'settings', section: 'actions', label: 'Settings', icon: 'gear', run: () => onSettings?.() });
  }
  for (const f of [
    { id: 'all', label: 'Filter: All services' },
    { id: 'live', label: 'Filter: Live only' },
    { id: 'off', label: 'Filter: Off only' },
  ]) {
    if (matches(query, f.label)) {
      actions.push({
        id: `filter-${f.id}`,
        section: 'actions',
        label: f.label,
        icon: 'search',
        run: () => setState({ filter: f.id, focusIndex: -1 }),
      });
    }
  }
  if (matches(query, 'sign out')) {
    actions.push({
      id: 'logout',
      section: 'actions',
      label: 'Sign out',
      icon: 'logout',
      run: async () => {
        try {
          await api.logout();
        } catch {
          /* leave anyway */
        }
        location.replace('/admin/login');
      },
    });
  }
  if (actions.length) sections.push({ id: 'actions', title: 'Actions', items: actions });

  const svcItems = [];
  for (const s of state.services.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const cmds = [
      { id: `edit-${s.name}`, label: `Edit — ${s.name}`, icon: 'chevron', run: () => onEdit?.(s) },
      { id: `copy-${s.name}`, label: `Copy token — ${s.name}`, icon: 'copy', run: () => copyServiceToken(s) },
      {
        id: `toggle-${s.name}`,
        label: s.enabled ? `Turn off — ${s.name}` : `Turn on — ${s.name}`,
        icon: s.enabled ? 'off' : 'on',
        run: () => toggleServiceEnabled(s),
      },
      {
        id: `rotate-${s.name}`,
        label: `Rotate token — ${s.name}`,
        icon: 'rotate',
        run: () => openRotateDialog({ service: s, onRotated: () => onReload?.() }),
      },
      {
        id: `dup-${s.name}`,
        label: `Duplicate — ${s.name}`,
        icon: 'copy',
        run: () => openDuplicateDialog({ service: s, onDuplicated: () => onReload?.() }),
      },
      {
        id: `delete-${s.name}`,
        label: `Delete — ${s.name}`,
        icon: 'close',
        danger: true,
        run: () => openDeleteDialog({ service: s, onDeleted: () => onReload?.() }),
      },
      {
        id: `select-${s.name}`,
        label: `Select — ${s.name}`,
        icon: 'check',
        run: () => {
          const items = filteredServices();
          const idx = items.findIndex((x) => x.name === s.name);
          if (idx >= 0) setState({ focusIndex: idx });
          if (!state.selected.includes(s.name)) toggleSelect(s.name);
        },
      },
    ];
    for (const c of cmds) {
      if (matches(query, c.label) || matches(query, s.name)) {
        svcItems.push({ ...c, section: 'services' });
      }
    }
  }
  let shown = svcItems;
  if (!query.trim()) {
    shown = svcItems.filter((c) => c.id.startsWith('edit-') || c.id.startsWith('rotate-')).slice(0, 8);
  }
  if (shown.length) sections.push({ id: 'services', title: 'Services', items: shown });
  return sections;
}
