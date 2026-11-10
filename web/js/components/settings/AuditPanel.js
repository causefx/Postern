import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { auditDetail, auditHeadline, auditIcon, auditServices, auditWhen } from '../../lib/auditDisplay.js';

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

function entryList(entries) {
  const blocks = [];
  let day = '';
  for (const ev of entries) {
    const when = auditWhen(ev.time);
    if (when.day !== day) {
      day = when.day;
      blocks.push(h('h3', { className: 'audit-day' }, day));
    }
    blocks.push(entryCard(ev, when));
  }
  return h('div', { className: 'audit-list' }, ...blocks);
}

function entryCard(ev, when) {
  const head = auditHeadline(ev);
  const detail = auditDetail(ev);
  return h(
    'article',
    { className: 'audit-item' },
    h('span', { className: 'audit-icon', 'aria-hidden': 'true' }, Icon(auditIcon(ev.action), { size: 15 })),
    h(
      'div',
      { className: 'audit-copy' },
      h(
        'div',
        { className: 'audit-title' },
        head.before,
        head.name ? h('span', { className: 'audit-name' }, head.name) : null,
      ),
      h(
        'div',
        { className: 'audit-sub' },
        detail ? h('div', { className: 'audit-detail' }, detail) : null,
        h('div', { className: 'audit-meta' }, when.meta),
      ),
    ),
  );
}
