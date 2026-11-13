import { h } from '../../lib/h.js';
import { state, setState, counts } from '../../state.js';

export function FilterBar() {
  const c = counts();
  const tabs = [
    { id: 'all', label: 'All', n: c.all },
    { id: 'live', label: 'Live', n: c.live },
    { id: 'off', label: 'Off', n: c.off },
  ];

  return h(
    'div',
    { className: 'flex flex-wrap items-center justify-between gap-3' },
    h(
      'div',
      {
        className: 'filter-tabs filter-tabs-responsive',
        role: 'tablist',
        'aria-label': 'Filter services',
      },
      ...tabs.map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': state.filter === t.id,
            className: `filter-tab${state.filter === t.id ? ' filter-tab-active' : ''}`,
            onClick: () => setState({ filter: t.id, focusIndex: -1 }),
          },
          t.label,
          h('span', { className: 'filter-tab-n' }, String(t.n)),
        ),
      ),
    ),
    h(
      'p',
      { className: 'm-0 text-[13px] text-muted desktop-only' },
      'Sorted by name',
      h('span', { className: 'text-muted/50 mx-1.5' }, '·'),
      'Tick rows for bulk actions.',
    ),
  );
}
