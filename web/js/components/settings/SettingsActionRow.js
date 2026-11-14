import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/** A settings row that opens a screen instead of a value: icon, name, one line, and a chevron. */
export function SettingsActionRow({ icon, title, hint, onClick }) {
  return h(
    'button',
    { type: 'button', className: 'settings-card settings-action', onClick },
    h('span', { className: 'settings-action-icon' }, Icon(icon, { size: 18 })),
    h(
      'span',
      { className: 'settings-acc-copy' },
      h('span', { className: 'settings-acc-title' }, title),
      h('span', { className: 'settings-acc-hint' }, hint),
    ),
    Icon('chevron', { size: 16, className: 'settings-chevron' }),
  );
}
