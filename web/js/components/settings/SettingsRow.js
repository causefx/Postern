import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/**
 * The right side of a row as DOM. A summary is { value, unit }, { dot, text }, { text, tone } or
 * { pill }; see lib/settings.js.
 */
export function summaryNodes(spec) {
  if (!spec) return [];
  if (spec.pill) return [h('span', { className: 'settings-pill' }, spec.pill)];
  const out = [];
  if (spec.dot) out.push(h('span', { className: `settings-dot is-${spec.dot}`, 'aria-hidden': 'true' }));
  if (spec.value != null) {
    out.push(h('span', { className: 'settings-sum-value' }, spec.value));
    if (spec.unit) out.push(h('span', { className: 'settings-sum-unit' }, spec.unit));
  }
  if (spec.text) out.push(h('span', { className: `settings-sum-text${spec.tone ? ` is-${spec.tone}` : ''}` }, spec.text));
  return out;
}

/** Replaces what a summary element shows. */
export function setSummary(el, spec) {
  el.replaceChildren(...summaryNodes(spec));
}

/**
 * One row of a settings group: an icon tile, the name and a line under it, what it is set to, and a
 * chevron. Pass `open` for a row that expands in place and its body as the children; leave it out
 * for a row that does something else when pressed. `tone: 'warn'` tints the icon.
 */
export function SettingsRow({ id, icon, title, hint, summary, tone, open, onClick }, ...body) {
  const expandable = open !== undefined;
  return h(
    'div',
    { className: `settings-row${open ? ' is-open' : ''}` },
    h(
      'button',
      {
        type: 'button',
        className: 'settings-row-head',
        'aria-expanded': expandable ? (open ? 'true' : 'false') : null,
        'aria-controls': expandable ? `${id}-panel` : null,
        onClick,
      },
      h('span', { className: `settings-row-icon${tone ? ` is-${tone}` : ''}` }, Icon(icon, { size: 18 })),
      h(
        'span',
        { className: 'settings-acc-copy' },
        h('span', { className: 'settings-acc-title' }, title),
        hint ? h('span', { className: 'settings-acc-hint' }, hint) : null,
      ),
      h('span', { className: 'settings-sum', 'data-summary': id }, ...summaryNodes(summary)),
      Icon('chevron', { size: 16, className: open ? 'settings-chevron is-open' : 'settings-chevron' }),
    ),
    open ? h('div', { id: `${id}-panel`, className: 'settings-acc-body' }, ...body) : null,
  );
}
