import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import {
  state,
  setState,
  clearSelection,
  filteredServices,
  toggleSelect,
} from '../../state.js';
import {
  copyServiceToken,
  toggleServiceEnabled,
  setManyEnabled,
} from '../../lib/serviceActions.js';
import { openBulkRotateDialog } from '../dialogs/BulkRotateDialog.js';
import { openBulkDeleteDialog } from '../dialogs/BulkDeleteDialog.js';
import { openRotateDialog } from '../dialogs/RotateTokenDialog.js';
import { openDeleteDialog } from '../dialogs/DeleteServiceDialog.js';

/**
 * Command palette overlay. Call with { onAdd, onReload }.
 * Visibility driven by state.commandOpen — parent remounts on state change.
 */
export function CommandPalette({ onAdd, onReload, onEdit }) {
  if (!state.commandOpen) return null;

  let query = '';
  let active = 0;
  const listEl = h('div', { className: 'cmd-list', role: 'listbox', 'aria-label': 'Commands' });
  const hintEl = h('span', { className: 'text-[12px] text-muted' }, '');

  const input = h('input', {
    type: 'text',
    className: 'cmd-input',
    placeholder: 'Type a command…',
    autocomplete: 'off',
    spellcheck: 'false',
    onInput: (e) => {
      query = e.target.value;
      active = 0;
      paint();
    },
    onKeydown: (e) => {
      const items = currentItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = items.length ? (active + 1) % items.length : 0;
        paint();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = items.length ? (active - 1 + items.length) % items.length : 0;
        paint();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[active];
        if (item) run(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
  });

  function close() {
    setState({ commandOpen: false });
  }

  function match(text) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return text.toLowerCase().includes(q);
  }

  function build() {
    const sections = [];
    const selected = state.services.filter((s) => state.selected.includes(s.name));
    const names = selected.map((s) => s.name);
    const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

    if (selected.length) {
      const bulk = [];
      const anyLive = selected.some((s) => s.enabled);
      if (anyLive && match(`turn off ${label}`)) {
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
      if (selected.some((s) => !s.enabled) && match(`turn on ${label}`)) {
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
      if (match(`rotate tokens for ${label}`)) {
        bulk.push({
          id: 'bulk-rotate',
          section: 'selected',
          label: `Rotate tokens for ${label}`,
          icon: 'rotate',
          run: () => openBulkRotateDialog({ names }),
        });
      }
      if (match(`delete ${label}`)) {
        bulk.push({
          id: 'bulk-delete',
          section: 'selected',
          label: `Delete ${label}`,
          icon: 'close',
          danger: true,
          run: () => openBulkDeleteDialog({ names }),
        });
      }
      if (match('clear selection')) {
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
    if (match('add service')) {
      actions.push({
        id: 'add',
        section: 'actions',
        label: 'Add service',
        icon: 'plus',
        run: () => onAdd?.(),
      });
    }
    for (const f of [
      { id: 'all', label: 'Filter: All services' },
      { id: 'live', label: 'Filter: Live only' },
      { id: 'off', label: 'Filter: Off only' },
    ]) {
      if (match(f.label)) {
        actions.push({
          id: `filter-${f.id}`,
          section: 'actions',
          label: f.label,
          icon: 'search',
          run: () => setState({ filter: f.id, focusIndex: 0 }),
        });
      }
    }
    if (match('sign out')) {
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
        {
          id: `edit-${s.name}`,
          label: `Edit — ${s.name}`,
          icon: 'chevron',
          run: () => onEdit?.(s),
        },
        {
          id: `copy-${s.name}`,
          label: `Copy token — ${s.name}`,
          icon: 'copy',
          run: () => copyServiceToken(s),
        },
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
          run: () =>
            openRotateDialog({
              service: s,
              onRotated: () => onReload?.(),
            }),
        },
        {
          id: `delete-${s.name}`,
          label: `Delete — ${s.name}`,
          icon: 'close',
          danger: true,
          run: () =>
            openDeleteDialog({
              service: s,
              onDeleted: () => onReload?.(),
            }),
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
        if (match(c.label) || match(s.name)) {
          svcItems.push({ ...c, section: 'services' });
        }
      }
    }
    // When querying, prefer matching service commands; when empty, show a short sample
    let shown = svcItems;
    if (!query.trim()) {
      shown = svcItems.filter((c) => c.id.startsWith('edit-') || c.id.startsWith('rotate-')).slice(0, 8);
    }
    if (shown.length) sections.push({ id: 'services', title: 'Services', items: shown });

    return sections;
  }

  let flat = [];

  function currentItems() {
    return flat;
  }

  function paint() {
    const sections = build();
    flat = sections.flatMap((s) => s.items);
    if (active >= flat.length) active = Math.max(0, flat.length - 1);
    listEl.replaceChildren();
    for (const sec of sections) {
      listEl.append(h('div', { className: 'cmd-section-title' }, sec.title));
      for (const item of sec.items) {
        const idx = flat.indexOf(item);
        listEl.append(
          h(
            'button',
            {
              type: 'button',
              role: 'option',
              'aria-selected': idx === active,
              className: `cmd-item${idx === active ? ' cmd-item-active' : ''}${item.danger ? ' cmd-item-danger' : ''}`,
              onMouseEnter: () => {
                active = idx;
                paint();
              },
              onClick: () => run(item),
            },
            Icon(item.icon || 'search', { size: 16, className: 'shrink-0 text-denim' }),
            h('span', { className: 'flex-1 text-left truncate' }, item.label),
          ),
        );
      }
    }
    if (!flat.length) {
      listEl.append(h('p', { className: 'px-4 py-6 text-sm text-muted m-0' }, 'No matching commands'));
    }
    hintEl.textContent = query.trim()
      ? '↑↓ move · Enter run'
      : "Try 'add', 'copy plex', 'turn off lidarr'";
  }

  async function run(item) {
    close();
    try {
      await item.run?.();
    } catch {
      /* toasts handle errors */
    }
  }

  paint();

  // Defer focus so dialog is in DOM
  queueMicrotask(() => input.focus());

  return h(
    'div',
    {
      className: 'cmd-overlay',
      role: 'presentation',
      onClick: (e) => {
        if (e.target.classList.contains('cmd-overlay')) close();
      },
      onKeydown: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      },
    },
    h(
      'div',
      {
        className: 'cmd-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Command palette',
      },
      h(
        'div',
        { className: 'cmd-search-row' },
        Icon('search', { size: 18, className: 'text-muted shrink-0' }),
        input,
      ),
      listEl,
      h(
        'div',
        { className: 'cmd-footer' },
        hintEl,
        h(
          'span',
          { className: 'inline-flex items-center gap-1.5 text-[12px] text-muted' },
          h('kbd', { className: 'kbd-hint' }, '↑'),
          h('kbd', { className: 'kbd-hint' }, '↓'),
          h('span', {}, 'Enter to run'),
        ),
      ),
    ),
  );
}
