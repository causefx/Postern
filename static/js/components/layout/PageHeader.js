import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

export function PageHeader({ onAdd }) {
  return h(
    'div',
    { className: 'flex flex-wrap items-end justify-between gap-4' },
    h(
      'div',
      { className: 'flex flex-col gap-1.5 max-w-xl' },
      h('h1', { className: 'font-display m-0 text-[30px] font-bold tracking-tight' }, 'Services'),
      h(
        'p',
        { className: 'm-0 text-muted text-[15px] leading-relaxed' },
        'Each service gets its own public route and caller token. Upstream API keys stay on this server.',
      ),
    ),
    h(
      'button',
      { type: 'button', className: 'btn btn-primary gap-2', onClick: onAdd },
      Icon('plus', { size: 16 }),
      'Add service',
    ),
  );
}
