import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { state, setState } from '../../state.js';
import { commandSections } from '../../lib/commands.js';

/**
 * Command palette overlay. Call with { onAdd, onReload }.
 * Visibility driven by state.commandOpen — parent remounts on state change.
 */
export function CommandPalette({ onAdd, onReload, onEdit, onSettings }) {
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

  function build() {
    return commandSections({ query, onAdd, onReload, onEdit, onSettings });
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
