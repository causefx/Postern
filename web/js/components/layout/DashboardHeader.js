import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { ThemeToggle } from '../common/ThemeToggle.js';
import { api } from '../../api.js';
import { state, counts } from '../../state.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { isDrawerOpen, getDrawerName } from '../drawer/ServiceDrawer.js';
import { isSettingsOpen } from '../settings/SettingsDrawer.js';

export function DashboardHeader({ onAdd, onOpenCommand, onSettings, onUpdate }) {
  const c = counts();
  const secure = state.meta.secure;
  const mod = isMac() ? '⌘' : 'Ctrl';
  const drawerName = isDrawerOpen() ? getDrawerName() : isSettingsOpen() ? 'Settings' : null;

  return h(
    'header',
    { className: 'dash-header border-b border-line-subtle bg-sunken' },
    h(
      'div',
      { className: 'dash-inner dash-header-grid py-3.5' },
      h(
        'div',
        { className: 'dash-header-left flex items-center gap-2.5 min-w-0' },
        h(
          'div',
          {
            className: 'w-8 h-8 rounded-[9px] bg-primary text-primary-content flex items-center justify-center shrink-0',
            'aria-hidden': 'true',
          },
          Icon('door', { size: 18 }),
        ),
        h(
          'div',
          { className: 'flex items-center gap-2 min-w-0' },
          h('span', { className: 'font-display text-[15px] font-semibold text-base-content desktop-only' }, 'Postern'),
          h('span', { className: 'text-muted/60 desktop-only', 'aria-hidden': 'true' }, '/'),
          h('span', { className: 'font-display text-[15px] font-semibold text-base-content' }, 'Services'),
          h('span', { className: 'count-badge' }, String(c.all)),
          drawerName
            ? h(
                'span',
                { className: 'desktop-only inline-flex items-center gap-2 min-w-0' },
                h('span', { className: 'text-muted/60' }, '/'),
                h('span', { className: 'font-display text-[15px] font-semibold text-base-content truncate' }, drawerName),
              )
            : null,
        ),
      ),
      h(
        'div',
        { className: 'dash-header-center' },
        h(
          'button',
          {
            type: 'button',
            className: 'cmd-trigger w-full max-w-xl',
            onClick: () => onOpenCommand?.(),
          },
          Icon('search', { size: 16, className: 'text-muted shrink-0' }),
          h('span', { className: 'flex-1 text-left text-muted truncate' }, 'Search or run a command'),
          h(
            'span',
            { className: 'desktop-only inline-flex items-center gap-1 shrink-0' },
            h('kbd', { className: 'kbd-hint' }, mod),
            h('kbd', { className: 'kbd-hint' }, 'K'),
          ),
        ),
      ),
      h(
        'div',
        { className: 'dash-header-right flex items-center justify-end gap-2.5' },
        !secure
          ? h(
              'span',
              {
                className: 'http-warn-icon',
                title: 'HTTP only — add HTTPS before exposing this admin UI remotely',
                'aria-label': 'HTTP only — add HTTPS before exposing this admin UI remotely',
                role: 'img',
              },
              Icon('warn', { size: 20 }),
            )
          : null,
        state.update?.available
          ? h(
              'button',
              {
                type: 'button',
                className: 'update-pill',
                title: `Update available: v${state.update.latest} (you have v${state.update.current}). See what changed.`,
                'aria-label': `Update available, version ${state.update.latest}`,
                onClick: onUpdate,
              },
              h('span', { className: 'update-pill-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'desktop-only' }, `v${state.update.latest} available`),
              h('span', { className: 'mobile-only' }, 'Update'),
            )
          : null,
        Button(
          {
            variant: 'ghost',
            size: 'sm',
            square: true,
            className: 'h-9 w-9 text-soft',
            'aria-label': 'Settings',
            title: 'Settings',
            onClick: onSettings,
          },
          Icon('gear', { size: 16 }),
        ),
        ThemeToggle(),
        Button(
          {
            variant: 'primary',
            size: 'sm',
            className: 'gap-1.5 h-9 px-3',
            onClick: onAdd,
          },
          Icon('plus', { size: 14 }),
          h('span', { className: 'desktop-only' }, 'Add'),
          h('kbd', { className: 'kbd-hint kbd-hint-on-primary desktop-only' }, 'N'),
        ),
        Button(
          {
            variant: 'ghost',
            size: 'sm',
            square: true,
            className: 'h-9 w-9 text-soft',
            'aria-label': 'Sign out',
            title: 'Sign out',
            onClick: async () => {
              try {
                await api.logout();
              } catch {
                /* leave */
              }
              location.replace('/admin/login');
            },
          },
          Icon('logout', { size: 16 }),
        ),
      ),
    ),
  );
}
