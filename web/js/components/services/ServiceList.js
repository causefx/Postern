import { h } from '../../lib/h.js';
import { filteredServices, state, setSelected, clearSelection, isSelected } from '../../state.js';
import { ServiceRow } from './ServiceRow.js';

export function ServiceList({ onOpen }) {
  const items = filteredServices();
  const allSelected = items.length > 0 && items.every((s) => isSelected(s.name));
  const someSelected = items.some((s) => isSelected(s.name));

  const wrap = h('div', { className: 'svc-table-wrap desktop-only', 'aria-label': 'Services' });

  if (!items.length) {
    wrap.append(h('p', { className: 'text-muted text-sm px-1 py-6' }, 'No services match this filter.'));
    return wrap;
  }

  const headCheck = h('input', {
    type: 'checkbox',
    className: 'svc-check',
    checked: allSelected,
    'aria-label': 'Select all visible',
    onChange: (e) => {
      if (e.target.checked) setSelected(items.map((s) => s.name));
      else clearSelection();
    },
  });
  headCheck.indeterminate = someSelected && !allSelected;

  wrap.append(
    h(
      'table',
      { className: 'svc-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { className: 'svc-th svc-td-check' }, headCheck),
          h('th', { className: 'svc-th' }, 'Status'),
          h('th', { className: 'svc-th' }, 'Name'),
          h('th', { className: 'svc-th svc-col-route' }, 'Route'),
          h('th', { className: 'svc-th' }, 'Upstream'),
          h('th', { className: 'svc-th svc-col-recent' }, 'Recent'),
          h('th', { className: 'svc-th' }, 'Callers use'),
          h('th', { className: 'svc-th svc-col-creds' }, 'Upstream creds'),
          h('th', { className: 'svc-th svc-td-actions' }, 'Actions'),
        ),
      ),
      h(
        'tbody',
        {},
        ...items.map((s, i) =>
          ServiceRow({
            service: s,
            index: i,
            focused: state.focusIndex === i,
            onOpen,
          }),
        ),
      ),
    ),
  );
  return wrap;
}
