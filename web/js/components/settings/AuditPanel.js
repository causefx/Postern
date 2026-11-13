import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import {
  auditChips,
  auditClock,
  auditDayKey,
  auditDayLabel,
  auditFullTime,
  auditIcon,
  auditServices,
  auditTitle,
} from '../../lib/auditDisplay.js';

/** Parsed admin audit log, filtered by service name. */
export function AuditPanel({ entries, service, onService }) {
  const names = auditServices(entries);
  const shown = !service || service === 'all' ? entries : entries.filter((ev) => ev.service === service);
  const chips = [['all', 'All'], ...names.map((name) => [name, name])];

  return h(
    'div',
    { className: 'audit-panel' },
    h(
      'div',
      { className: 'settings-chips', role: 'group', 'aria-label': 'Services in the log' },
      ...chips.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            className: id === (service || 'all') ? 'settings-chip is-active' : 'settings-chip',
            'aria-pressed': id === (service || 'all') ? 'true' : 'false',
            onClick: () => onService(id),
          },
          label,
        ),
      ),
    ),
    shown.length ? entryList(shown) : h('p', { className: 'settings-empty' }, 'No admin changes yet.'),
    shown.length
      ? h(
          'details',
          { className: 'audit-raw' },
          h('summary', {}, 'Raw log lines'),
          h('pre', { className: 'audit-raw-body' }, shown.map((ev) => JSON.stringify(ev)).join('\n')),
        )
      : null,
  );
}

/** One card per local day, newest first: the day label inside the card, then one row per change. */
function entryList(entries) {
  const days = [];
  for (const ev of entries) {
    const key = auditDayKey(ev.time);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else days.push({ key, label: auditDayLabel(ev.time), events: [ev] });
  }
  return h(
    'div',
    { className: 'audit-list' },
    ...days.map((day) =>
      h(
        'section',
        { className: 'audit-day-card', 'aria-label': day.label },
        h('h3', { className: 'audit-day' }, day.label),
        h('div', { className: 'audit-day-rows' }, ...day.events.map(entryRow)),
      ),
    ),
  );
}

function entryRow(ev) {
  const chips = auditChips(ev);
  const { icon, tone } = auditIcon(ev);
  return h(
    'article',
    { className: 'audit-ev' },
    h('span', { className: `audit-ev-icon is-${tone}`, 'aria-hidden': 'true' }, Icon(icon, { size: 15 })),
    h(
      'div',
      { className: 'audit-ev-main' },
      h(
        'div',
        { className: 'audit-ev-top' },
        h(
          'div',
          { className: 'audit-ev-title' },
          ...auditTitle(ev).map((part) => (part.strong ? h('b', {}, part.text) : part.text)),
        ),
        h('time', { className: 'audit-ev-time', datetime: ev.time, title: auditFullTime(ev.time) }, auditClock(ev.time)),
      ),
      // Only rendered when there is something to show, so single-line rows stay single-line.
      chips.length ? h('div', { className: 'audit-ev-meta' }, ...chips.map((c) => h('span', { className: 'audit-chip' }, c))) : null,
    ),
  );
}
