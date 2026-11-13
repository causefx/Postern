import { h } from '../../lib/h.js';
import { api } from '../../api.js';
import { Icon } from '../common/Icon.js';
import { StatusBadge } from '../common/StatusBadge.js';
import {
  activityErrorCount,
  groupActivityByDay,
  isActivityError,
  matchActivity,
  requestClock,
  requestWhen,
  splitActivity,
} from '../../lib/serviceDisplay.js';

const POLL_MS = 3000;

/**
 * Requests tab: recent proxy requests across every service, newest first.
 * Each service keeps its own capped history, so this is those tails merged by time.
 * Call start() when the tab is shown and stop() when it is hidden.
 */
export function RequestsPanel() {
  const root = h('div', { className: 'requests-panel' });
  let events = [];
  let total = 0;
  let loaded = false;
  let failed = false;
  let query = '';
  /** '' | 'errors' */
  let kind = '';
  /** '' (all) or a service name */
  let service = '';
  let timer = 0;
  let sig = '';

  const eventSig = (ev) => `${ev.time}|${ev.service}|${ev.status}|${ev.who}|${ev.reason || ''}|${ev.method}|${ev.path}`;

  function serviceNames() {
    return [...new Set(events.map((ev) => ev.service))].sort((a, b) => a.localeCompare(b));
  }

  function visible() {
    return events.filter((ev) => {
      if (service && ev.service !== service) return false;
      if (kind === 'errors' && !isActivityError(ev)) return false;
      return matchActivity(ev, query) || String(ev.service || '').toLowerCase().includes(query.trim().toLowerCase());
    });
  }

  function chip(label, pressed, onClick, count) {
    return h(
      'button',
      {
        type: 'button',
        className: `activity-filter-chip${pressed ? ' is-active' : ''}`,
        'aria-pressed': pressed ? 'true' : 'false',
        onClick,
      },
      label,
      count != null ? h('span', { className: 'activity-filter-count' }, String(count)) : null,
    );
  }

  function row(ev, older, zebra) {
    const { who, reason } = splitActivity(ev);
    const line = `${ev.method || ''} ${ev.path || ''}`.trim() || '—';
    return h(
      'div',
      { className: `req-row${zebra ? ' is-zebra' : ''}` },
      StatusBadge(ev.status),
      h('span', { className: 'req-who', title: who || '' }, who || '—'),
      reason
        ? h('span', { className: `req-paused is-${reason}`, title: reason }, reason)
        : h('span', { className: 'req-paused is-empty', 'aria-hidden': 'true' }),
      h(
        'span',
        { className: 'req-path', title: `${ev.service} · ${line}` },
        h('span', { className: 'req-svc' }, ev.service),
        line,
      ),
      h('span', { className: 'req-time', title: ev.time || '' }, older ? requestWhen(ev.time) : requestClock(ev.time)),
    );
  }

  function listNodes() {
    if (failed && !loaded) return [h('p', { className: 'settings-empty' }, 'Could not load requests.')];
    if (!loaded) return [h('p', { className: 'settings-empty' }, 'Loading requests…')];
    if (!events.length) return [h('p', { className: 'settings-empty' }, 'No requests yet.')];
    const rows = visible();
    if (!rows.length) return [h('p', { className: 'settings-empty' }, 'No matching requests.')];
    return groupActivityByDay(rows).map((g) =>
      h(
        'section',
        { className: 'req-day-card', 'aria-label': g.label },
        h('h3', { className: 'req-day-label' }, g.label),
        h('div', { className: 'req-day-rows' }, ...g.events.map((ev, i) => row(ev, g.kind === 'older', i % 2 === 1))),
      ),
    );
  }

  function metaText() {
    if (!loaded || !events.length) return '';
    const shown = visible().length;
    const filtered = !!(query.trim() || kind || service);
    if (filtered) return `${shown} of ${events.length}`;
    return total > events.length ? `newest ${events.length} of ${total}` : `${events.length}`;
  }

  function paintBody() {
    root.querySelector('[data-req-list]')?.replaceChildren(...listNodes());
    const meta = root.querySelector('[data-req-meta]');
    if (meta) meta.textContent = metaText();
    root.querySelector('[data-req-chips]')?.replaceChildren(...chipNodes());
  }

  function chipNodes() {
    return [
      chip('All', !kind && !service, () => {
        kind = '';
        service = '';
        paintBody();
      }),
      chip(
        'Errors',
        kind === 'errors',
        () => {
          kind = kind === 'errors' ? '' : 'errors';
          paintBody();
        },
        activityErrorCount(events),
      ),
      ...serviceNames().map((name) =>
        chip(name, service === name, () => {
          service = service === name ? '' : name;
          paintBody();
        }),
      ),
    ];
  }

  function paintAll() {
    root.replaceChildren(
      h(
        'div',
        { className: 'requests-tools' },
        h(
          'label',
          { className: 'activity-search min-w-0 flex-1' },
          Icon('search', { size: 15, className: 'text-muted' }),
          h('input', {
            type: 'search',
            placeholder: 'Service, token, path, or status',
            autocomplete: 'off',
            'aria-label': 'Search requests',
            value: query,
            onInput: (e) => {
              query = e.currentTarget.value;
              paintBody();
            },
          }),
        ),
        h('span', { className: 'requests-meta', 'data-req-meta': '1' }, metaText()),
      ),
      h('div', { className: 'activity-filters', role: 'group', 'aria-label': 'Filter requests', 'data-req-chips': '1' }, ...chipNodes()),
      h('div', { className: 'requests-list', 'data-req-list': '1' }, ...listNodes()),
    );
  }

  async function pull() {
    if (!root.isConnected) {
      stop();
      return;
    }
    try {
      const data = await api.allActivity();
      const next = Array.isArray(data?.entries) ? data.entries : [];
      failed = false;
      const nextSig = `${data?.total}|${next.map(eventSig).join('\n')}`;
      if (loaded && nextSig === sig) return;
      sig = nextSig;
      events = next;
      total = Number(data?.total) || next.length;
      if (service && !events.some((ev) => ev.service === service)) service = '';
      const first = !loaded;
      loaded = true;
      if (first) paintAll();
      else paintBody();
    } catch {
      failed = true;
      if (!loaded) paintBody();
      /* otherwise keep the lines already shown */
    }
  }

  function start() {
    if (timer) return;
    pull();
    timer = window.setInterval(pull, POLL_MS);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  paintAll();
  return { el: root, start, stop };
}
