import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

export function FlowDiagram() {
  return h(
    'section',
    { className: 'flex flex-wrap items-center gap-3 pt-4', 'aria-label': 'How a request flows' },
    h('span', { className: 'label-caps w-full' }, 'How a request flows'),
    node('Caller', 'Bearer caller token'),
    Icon('arrow', { size: 16, className: 'text-denim' }),
    node('Postern', '/p/<name>/… · checks token'),
    Icon('arrow', { size: 16, className: 'text-denim' }),
    node('Service', 'private, its own auth'),
  );
}

function node(title, sub) {
  return h(
    'div',
    { className: 'flex flex-col gap-0.5 px-4 py-3 rounded-xl border border-slate bg-base-200 min-w-[150px]' },
    h('span', { className: 'font-semibold text-sm' }, title),
    h('span', { className: 'text-xs text-muted font-mono' }, sub),
  );
}
