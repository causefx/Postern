import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { THEME_OPTIONS, getThemePreference, onThemeChange, setThemePreference } from '../../lib/theme.js';
import { HTTPS_HELP_URL, httpsWarningVisible, dismissHttpsWarning } from '../../lib/httpsNotice.js';

/** Shown when the sign-in has no email: a password session, or a provider that sent none. */
const DEFAULT_NAME = 'admin';
const THEME_ORDER = ['system', 'light', 'dark'];

/** Kept outside the component: the page repaints on every state change and the menu must stay open. */
let open = false;

function signOut() {
  return api
    .logout()
    .catch(() => {
      /* leave anyway */
    })
    .then(() => location.replace('/admin/login'));
}

function closeMenu() {
  if (!open) return;
  open = false;
  const wrap = document.querySelector('.acct-wrap');
  if (!wrap) return;
  wrap.classList.remove('is-open');
  wrap.querySelector('.acct-avatar')?.setAttribute('aria-expanded', 'false');
}

// One pair of listeners for the whole page; the menu element itself is replaced on each repaint.
document.addEventListener(
  'click',
  (e) => {
    if (open && !e.target.closest?.('.acct-wrap')) closeMenu();
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (!open || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    document.querySelector('.acct-avatar')?.focus();
  },
  true,
);

/**
 * Avatar button with the account menu: sign-in details, the HTTPS warning, Settings, Theme and
 * Sign out. A popover on desktop and a sheet that slides up from the bottom on a phone (see .acct-*
 * in input.css).
 */
export function AccountMenu({ onSettings }) {
  const dot = h('span', { className: 'acct-dot', 'aria-hidden': 'true' });
  const warning = h('div', { className: 'acct-warn', role: 'status' });
  const themeHost = h('div', { className: 'acct-seg', role: 'radiogroup', 'aria-label': 'Theme' });

  const avatar = h(
    'button',
    {
      type: 'button',
      className: 'acct-avatar',
      'aria-label': 'Account menu',
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      onClick: (e) => {
        e.stopPropagation();
        // detail is 0 for a keyboard "click": only then move focus into the menu.
        toggle(e.detail === 0);
      },
    },
    Icon('user', { size: 18 }),
    dot,
  );

  const sheet = h(
    'div',
    { className: 'acct-sheet', role: 'menu', 'aria-label': 'Account' },
    h('div', { className: 'acct-grab', 'aria-hidden': 'true' }),
    h(
      'div',
      { className: 'acct-who' },
      h('span', { className: 'acct-who-mark', 'aria-hidden': 'true' }, Icon('user', { size: 18 })),
      h(
        'div',
        { className: 'min-w-0' },
        h('div', { className: 'acct-who-name', title: state.meta.email || null }, state.meta.email || DEFAULT_NAME),
        h('div', { className: 'acct-who-host' }, location.host),
      ),
    ),
    warning,
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        className: 'acct-item',
        onClick: () => {
          closeMenu();
          onSettings?.();
        },
      },
      Icon('gear', { size: 16, className: 'text-muted' }),
      h('span', { className: 'acct-item-label' }, 'Settings'),
      h('kbd', { className: 'kbd-hint desktop-only' }, ','),
    ),
    h('div', { className: 'acct-item acct-theme' }, Icon('moon', { size: 16, className: 'text-muted' }), h('span', { className: 'acct-item-label' }, 'Theme'), themeHost),
    h('div', { className: 'acct-sep', role: 'separator' }),
    h(
      'button',
      { type: 'button', role: 'menuitem', className: 'acct-item', onClick: () => void signOut() },
      Icon('logout', { size: 16, className: 'text-muted' }),
      h('span', { className: 'acct-item-label' }, 'Sign out'),
    ),
  );

  const backdrop = h('div', { className: 'acct-backdrop', 'aria-hidden': 'true', onClick: () => closeMenu() });
  const wrap = h('div', { className: `acct-wrap${open ? ' is-open' : ''}` }, avatar, backdrop, sheet);

  function paintWarning() {
    const show = httpsWarningVisible();
    dot.hidden = !show;
    warning.hidden = !show;
    if (!show) {
      warning.replaceChildren();
      return;
    }
    warning.replaceChildren(
      Icon('warn', { size: 16, className: 'acct-warn-icon' }),
      h(
        'div',
        { className: 'min-w-0' },
        h('div', { className: 'acct-warn-title' }, 'Not encrypted'),
        h('p', { className: 'acct-warn-text' }, 'Tokens travel in plain text. Put HTTPS in front before exposing Postern.'),
        h(
          'div',
          { className: 'acct-warn-actions' },
          h('a', { href: HTTPS_HELP_URL, target: '_blank', rel: 'noopener noreferrer' }, 'How to add HTTPS'),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                dismissHttpsWarning();
                paintWarning();
              },
            },
            'Dismiss',
          ),
        ),
      ),
    );
  }

  function paintTheme() {
    const current = getThemePreference();
    themeHost.replaceChildren(
      ...THEME_ORDER.map((id) => THEME_OPTIONS.find((o) => o.id === id)).map((o) => {
        const on = o.id === current;
        return h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': o.label,
            title: o.label,
            className: `acct-seg-btn${on ? ' is-on' : ''}`,
            onClick: () => setThemePreference(o.id),
          },
          Icon(o.icon, { size: 14 }),
          on ? h('span', {}, o.label) : null,
        );
      }),
    );
  }

  function toggle(byKeyboard) {
    open = !open;
    wrap.classList.toggle('is-open', open);
    avatar.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && byKeyboard) sheet.querySelector('.acct-item')?.focus({ preventScroll: true });
  }

  // The palette and the login page change the theme too; keep the control in step, and stop once removed.
  const off = onThemeChange(() => {
    if (!wrap.isConnected) return off();
    paintTheme();
  });

  paintWarning();
  paintTheme();
  return wrap;
}
