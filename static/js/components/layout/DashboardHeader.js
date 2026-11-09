import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { state, counts } from '../../state.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { isDrawerOpen, getDrawerName } from '../drawer/ServiceDrawer.js';

export function DashboardHeader({ onAdd, onOpenCommand }) {
  const c = counts();
  const secure = state.meta.secure;
  const mod = isMac() ? '⌘' : 'Ctrl';
  const drawerName = isDrawerOpen() ? getDrawerName() : null;

  return h(
    'header',
    { className: 'dash-header border-b border-line bg-ink-raised/80' },
    h(
      'div',
      { className: 'dash-inner flex flex-wrap items-center gap-3 py-3.5' },
      h(
        'div',
        { className: 'flex items-center gap-2 min-w-0 shrink-0' },
        h(
          'div',
          {
            className:
              'w-8 h-8 rounded-[9px] bg-eggshell text-ink flex items-center justify-center mobile-only',
            'aria-hidden': 'true',
          },
          Icon('door', { size: 18 }),
        ),
        h('span', { className: 'font-display text-[15px] font-semibold text-muted desktop-only' }, 'Postern'),
        h('span', { className: 'text-muted/60 desktop-only', 'aria-hidden': 'true' }, '/'),
        h('span', { className: 'font-display text-[15px] font-semibold text-eggshell' }, 'Services'),
        h('span', { className: 'count-badge desktop-only' }, String(c.all)),
        drawerName
          ? h(
              'span',
              { className: 'desktop-only inline-flex items-center gap-2 min-w-0' },
              h('span', { className: 'text-muted/60' }, '/'),
              h('span', { className: 'font-display text-[15px] font-semibold text-eggshell truncate' }, drawerName),
            )
          : null,
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cmd-trigger flex-1 min-w-[160px] max-w-xl',
          onClick: () => onOpenCommand?.(),
        },
        Icon('search', { size: 16, className: 'text-muted shrink-0' }),
        h('span', { className: 'flex-1 text-left text-muted truncate' }, 'Search or run a command'),
        h('kbd', { className: 'kbd-hint desktop-only' }, `${mod} K`),
      ),
      h(
        'div',
        { className: 'flex items-center gap-2.5 ml-auto shrink-0' },
        !secure
          ? h(
              'span',
              { className: 'inline-flex items-center gap-1.5 text-[13px] text-warn desktop-only' },
              Icon('warn', { size: 14 }),
              'HTTP only',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary btn-sm gap-1.5 h-9 px-3',
            onClick: onAdd,
          },
          Icon('plus', { size: 14 }),
          h('span', { className: 'desktop-only' }, 'Add'),
          h('kbd', { className: 'kbd-hint kbd-hint-on-primary desktop-only' }, 'N'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm h-9 gap-1.5 text-cream-dim desktop-only',
            onClick: async () => {
              try {
                await api.logout();
              } catch {
                /* leave */
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
