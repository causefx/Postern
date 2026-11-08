import { h } from '../../lib/h.js';
import { api } from '../../api.js';
import { Icon } from '../common/Icon.js';
import { state } from '../../state.js';

export function AppHeader() {
  const listen = state.meta.listen || location.host;
  const secure = state.meta.secure;
  return h(
    'header',
    { className: 'border-b border-line bg-ink-raised' },
    h(
      'div',
      { className: 'max-w-[1200px] mx-auto px-6 py-3.5 flex flex-wrap items-center justify-between gap-4' },
      h(
        'div',
        { className: 'flex items-center gap-3' },
        h(
          'div',
          { className: 'w-9 h-9 rounded-[10px] bg-eggshell text-ink flex items-center justify-center', 'aria-hidden': 'true' },
          Icon('door', { size: 22 }),
        ),
        h(
          'div',
          { className: 'flex flex-col' },
          h('span', { className: 'font-display text-lg font-bold tracking-tight' }, 'Postern'),
          h('span', { className: 'text-xs text-muted' }, 'Private services, public front door'),
        ),
      ),
      h(
        'div',
        { className: 'flex items-center gap-2.5 flex-wrap' },
        h(
          'span',
          { className: 'badge badge-ghost h-8 gap-1.5 font-mono font-medium border border-line bg-base-200 text-cream-dim' },
          Icon('globe', { size: 14 }),
          listen,
        ),
        !secure
          ? h(
              'span',
              { className: 'badge h-8 gap-1.5 bg-warn/15 text-warn border-0' },
              Icon('warn', { size: 14 }),
              'HTTP only',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm h-8 gap-1.5 text-cream-dim',
            onclick: async () => {
              try {
                await api.logout();
              } catch {
                /* still leave */
              }
              location.replace('/admin/login');
            },
          },
          Icon('logout', { size: 14 }),
          'Sign out',
        ),
      ),
    ),
  );
}
