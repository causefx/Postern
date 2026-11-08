import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { state, setState, counts } from '../../state.js';

export function ServiceToolbar() {
  const c = counts();
  const tabs = [
    { id: 'all', label: 'All', n: c.all },
    { id: 'live', label: 'Live', n: c.live },
    { id: 'off', label: 'Off', n: c.off },
  ];

  return h(
    'div',
    { className: 'flex flex-wrap justify-between items-center gap-3' },
    h(
      'div',
      { className: 'relative flex-1 max-w-xs min-w-[220px]' },
      h('span', { className: 'absolute left-3.5 top-3.5 text-muted pointer-events-none' }, Icon('search', { size: 16 })),
      h('label', { className: 'sr-only', htmlFor: 'svc-search' }, 'Search services'),
      h('input', {
        id: 'svc-search',
        type: 'search',
        className: 'input w-full pl-10',
        placeholder: 'Search by name or upstream',
        value: state.query,
        onInput: (e) => setState({ query: e.target.value }),
      }),
    ),
    h(
      'div',
      {
        className: 'flex gap-1 p-1 rounded-[10px] bg-base-200 border border-line',
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
            className: `h-9 px-3.5 rounded-lg border-0 text-[13px] font-semibold cursor-pointer inline-flex items-center gap-2 ${
              state.filter === t.id ? 'bg-slate text-eggshell' : 'bg-transparent text-muted hover:text-eggshell'
            }`,
            onClick: () => setState({ filter: t.id }),
          },
          t.label,
          h('span', { className: 'text-[11px] font-semibold bg-slate text-cream-dim rounded-full px-1.5 py-0.5' }, String(t.n)),
        ),
      ),
    ),
  );
}
