import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/** One settings row. The body is shown while open. */
export function SettingsAccordion({ id, title, hint, summary, open, onToggle }, ...body) {
  return h(
    'section',
    { className: 'settings-card' },
    h(
      'button',
      {
        type: 'button',
        className: 'settings-acc-head',
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': `${id}-panel`,
        onClick: onToggle,
      },
      h(
        'span',
        { className: 'settings-acc-copy' },
        h('span', { className: 'settings-acc-title' }, title),
        h('span', { className: 'settings-acc-hint' }, hint),
      ),
      h('span', { className: 'settings-acc-summary', 'data-summary': id }, summary),
      Icon('chevron', { size: 16, className: open ? 'settings-chevron is-open' : 'settings-chevron' }),
    ),
    open ? h('div', { id: `${id}-panel`, className: 'settings-acc-body' }, ...body) : null,
  );
}
