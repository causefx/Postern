import { h } from '../../lib/h.js';
import { showToast } from '../common/Toast.js';
import { api } from '../../api.js';
import { blankServiceRecent } from '../../lib/liveList.js';
import {
  activityErrorCount,
  activityWhoFilters,
  groupActivityByDay,
  isActivityError,
  matchActivity,
  requestClock,
  requestWhen,
} from '../../lib/serviceDisplay.js';
import { Icon } from '../common/Icon.js';
import { StatusBadge } from '../common/StatusBadge.js';

/**
 * Requests tab: recent proxy requests for this service.
 */
export function UsagePanel({ savedName }) {
  const wrap = h('div', { className: 'usage-panel flex min-h-0 flex-1 flex-col gap-3' });
  let events = [];
  let eventsLoaded = false;
  let following = false;
  let liveTimer = 0;
  let logSig = '';
  let generation = 0;
  let query = '';
  /** '' | 'errors' | token who */
  let whoFilter = '';

  function eventSig(ev) {
    return `${ev.time}|${ev.status}|${ev.who}|${ev.reason || ''}|${ev.method}|${ev.path}`;
  }

  function visibleEvents() {
    return events
      .slice()
      .reverse()
      .filter((ev) => {
        if (whoFilter === 'errors') {
          if (!isActivityError(ev)) return false;
        } else if (whoFilter && String(ev.who || '') !== whoFilter) {
          return false;
        }
        return matchActivity(ev, query);
      });
  }

  function rowEl(ev, kind, zebra) {
    const refused = ev.reason === 'paused' || ev.reason === 'expired' || ev.who === 'paused';
    const refusedLabel = ev.reason === 'expired' ? 'expired' : 'paused';
    const who = ev.who && ev.who !== 'paused' ? ev.who : '';
    const timeLabel = kind === 'older' ? requestWhen(ev.time) : requestClock(ev.time);
    return h(
      'div',
      { className: `req-row${zebra ? ' is-zebra' : ''}` },
      StatusBadge(ev.status),
      h('span', { className: 'req-who', title: who || '' }, who || '—'),
      refused
        ? h('span', { className: `req-paused${refusedLabel === 'expired' ? ' is-expired' : ''}` }, refusedLabel)
        : h('span', { className: 'req-paused is-empty', 'aria-hidden': 'true' }),
      h(
        'span',
        { className: 'req-path', title: `${ev.method || ''} ${ev.path || ''}` },
        `${ev.method || ''} ${ev.path || ''}`.trim() || '—',
      ),
      h('span', { className: 'req-time', title: ev.time || '' }, timeLabel),
    );
  }

  function logNodes() {
    if (!events.length) {
      return [h('p', { className: 'm-0 text-xs text-muted px-1' }, 'No requests yet.')];
    }
    const rows = visibleEvents();
    if (!rows.length) {
      return [h('p', { className: 'm-0 text-xs text-muted px-1' }, 'No matching requests.')];
    }
    const groups = groupActivityByDay(rows);
    return groups.map((g) =>
      h(
        'section',
        { className: 'req-day-card', 'aria-label': g.label },
        h('h3', { className: 'req-day-label' }, g.label),
        h(
          'div',
          { className: 'req-day-rows' },
          ...g.events.map((ev, i) => rowEl(ev, g.kind, i % 2 === 1)),
        ),
      ),
    );
  }

  function metaText() {
    if (!events.length || (!query.trim() && !whoFilter)) return '';
    return `${visibleEvents().length} of ${events.length}`;
  }

  function renderLog() {
    wrap.querySelector('[data-activity-log]')?.replaceChildren(...logNodes());
    const meta = wrap.querySelector('[data-activity-meta]');
    if (meta) meta.textContent = metaText();
    const filters = wrap.querySelector('[data-activity-filters]');
    if (filters) filters.replaceChildren(...filterNodes());
  }

  function filterNodes() {
    const errCount = activityErrorCount(events);
    const chips = [
      { id: '', label: 'All' },
      {
        id: 'errors',
        label: 'Errors',
        count: errCount,
      },
      ...activityWhoFilters(events).map((who) => ({ id: who, label: who })),
    ];
    return chips.map((chip) =>
      h(
        'button',
        {
          type: 'button',
          className: `activity-filter-chip${whoFilter === chip.id ? ' is-active' : ''}`,
          'aria-pressed': whoFilter === chip.id ? 'true' : 'false',
          onClick: () => {
            whoFilter = chip.id;
            renderLog();
          },
        },
        chip.label,
        chip.count != null
          ? h('span', { className: 'activity-filter-count' }, String(chip.count))
          : null,
      ),
    );
  }

  function stopLive() {
    if (liveTimer) window.clearInterval(liveTimer);
    liveTimer = 0;
  }

  async function pullActivity() {
    if (!wrap.isConnected) {
      stopLive();
      return;
    }
    const gen = generation;
    try {
      const list = await api.activity(savedName);
      if (gen !== generation) return;
      const next = Array.isArray(list) ? list : [];
      const nextSig = next.map(eventSig).join('\n');
      if (nextSig === logSig) return;
      logSig = nextSig;
      events = next;
      if (
        whoFilter &&
        whoFilter !== 'errors' &&
        !activityWhoFilters(events).includes(whoFilter)
      ) {
        whoFilter = '';
      }
      renderLog();
    } catch {
      /* keep the lines already shown */
    }
  }

  function paintFollowing(button) {
    button.setAttribute('aria-pressed', following ? 'true' : 'false');
    button.setAttribute('aria-label', following ? 'Stop following' : 'Follow new requests');
    const iconHost = button.querySelector('[data-follow-icon]');
    if (iconHost) {
      iconHost.replaceChildren(Icon(following ? 'pause' : 'play', { size: 14 }));
    }
    const label = button.querySelector('[data-follow-label]');
    if (label) label.textContent = following ? 'Following' : 'Follow';
  }

  async function clearRecent(button) {
    if (!savedName || button.disabled) return;
    button.disabled = true;
    generation += 1;
    try {
      await api.clearActivity(savedName);
      generation += 1;
      events = [];
      logSig = '';
      whoFilter = '';
      renderLog();
      blankServiceRecent(savedName);
    } catch (err) {
      showToast(err.message || 'Could not clear recent requests', 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function toggleFollowing(button) {
    following = !following;
    paintFollowing(button);
    stopLive();
    if (!following) return;
    pullActivity();
    liveTimer = window.setInterval(pullActivity, 2000);
  }

  function paint() {
    if (!savedName) {
      wrap.replaceChildren(
        h('p', { className: 'm-0 text-xs text-muted' }, 'Save the service to see recent requests.'),
      );
      return;
    }
    wrap.replaceChildren(
      h(
        'div',
        { className: 'flex min-h-0 flex-1 flex-col gap-2.5' },
        h(
          'div',
          { className: 'flex shrink-0 flex-wrap items-center gap-2' },
          h(
            'label',
            { className: 'activity-search min-w-0 flex-1' },
            Icon('search', { size: 15, className: 'text-muted' }),
            h('input', {
              type: 'search',
              placeholder: 'Token, path, or status',
              autocomplete: 'off',
              'aria-label': 'Search recent requests',
              value: query,
              onInput: (e) => {
                query = e.currentTarget.value;
                renderLog();
              },
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'following-toggle',
              'aria-pressed': following ? 'true' : 'false',
              'aria-label': following ? 'Stop following' : 'Follow new requests',
              onClick: (e) => toggleFollowing(e.currentTarget),
            },
            h('span', { 'data-follow-icon': '1', className: 'inline-flex' }, Icon(following ? 'pause' : 'play', { size: 14 })),
            h('span', { 'data-follow-label': '1' }, following ? 'Following' : 'Follow'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'activity-clear-link',
              'aria-label': 'Clear recent requests',
              onClick: (e) => clearRecent(e.currentTarget),
            },
            'Clear…',
          ),
        ),
        h(
          'div',
          { className: 'flex shrink-0 gap-2' },
          h('div', { className: 'activity-filters min-w-0 flex-1', 'data-activity-filters': '1' }, ...filterNodes()),
          // The "3 of 20" count sits beside the chips so the list keeps the full height below.
          h(
            'span',
            { className: 'shrink-0 self-start whitespace-nowrap text-xs leading-7 text-muted', 'data-activity-meta': '1' },
            metaText(),
          ),
        ),
        h('div', { className: 'activity-log-scroll', 'data-activity-log': '1' }, ...logNodes()),
      ),
    );
  }

  paint();
  if (savedName && !eventsLoaded) {
    eventsLoaded = true;
    api
      .activity(savedName)
      .then((list) => {
        events = Array.isArray(list) ? list : [];
        logSig = events.map(eventSig).join('\n');
        paint();
      })
      .catch(() => {});
  }
  wrap._refresh = paint;
  return wrap;
}
