import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { filteredServices, state, setState, isSelected, toggleSelect } from '../../state.js';
import { credBits } from '../../lib/serviceDisplay.js';
import { copyServiceToken, toggleServiceEnabled } from '../../lib/serviceActions.js';

const LONG_MS = 480;
const SWIPE_W = 168;

/** Only one row open at a time. */
let openTrack = null;

export function MobileServiceList({ onOpen }) {
  const items = filteredServices();
  const wrap = h('div', { className: 'mobile-svc-list mobile-only', 'aria-label': 'Services' });

  if (!items.length) {
    wrap.append(h('p', { className: 'text-muted text-sm px-1 py-6' }, 'No services match this filter.'));
    return wrap;
  }

  for (let i = 0; i < items.length; i++) {
    wrap.append(mobileRow(items[i], i, onOpen));
  }

  wrap.append(
    h(
      'p',
      { className: 'm-0 px-1 pt-3 text-[12px] text-muted' },
      'Swipe a row for quick actions · press and hold to select several',
    ),
  );

  return wrap;
}

function mobileRow(service, index, onOpen) {
  const selected = isSelected(service.name);
  const focused = state.focusIndex === index;
  const bits = credBits(service.auth);
  const meta = [`/p/${service.name}/`, ...bits];
  if (!service.enabled) meta.push('off');

  const content = h(
    'div',
    {
      className: [
        'mobile-row-content',
        focused ? 'svc-tr-focus' : '',
        selected ? 'svc-tr-selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
    h('span', {
      className: `mobile-status-dot${service.enabled ? ' is-live' : ''}`,
      'aria-hidden': 'true',
    }),
    h(
      'div',
      { className: 'flex-1 min-w-0 flex flex-col gap-0.5' },
      h('span', { className: 'svc-name text-[15px]' }, service.name),
      h('span', { className: 'font-mono text-[12px] text-muted truncate' }, meta.join(' · ')),
    ),
    Icon('chevron', { size: 16, className: 'text-muted -rotate-90 shrink-0' }),
  );

  const powerLabel = service.enabled ? 'Turn off' : 'Turn on';
  const actions = h(
    'div',
    { className: 'mobile-row-actions', 'aria-hidden': 'true' },
    h(
      'button',
      {
        type: 'button',
        className: 'mobile-action',
        'aria-label': 'Copy token',
        onClick: (e) => {
          e.stopPropagation();
          copyServiceToken(service);
          resetSwipe(track);
        },
      },
      Icon('copy', { size: 18 }),
      h('span', {}, 'Copy token'),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'mobile-action mobile-action-power',
        'aria-label': powerLabel,
        onClick: (e) => {
          e.stopPropagation();
          toggleServiceEnabled(service);
          resetSwipe(track);
        },
      },
      Icon('power', { size: 18 }),
      h('span', {}, powerLabel),
    ),
  );

  const track = h('div', { className: 'mobile-row-track' }, content, actions);
  const row = h('div', { className: 'mobile-row', dataset: { name: service.name } }, track);

  function syncContentWidth() {
    // Content must be exactly the row width; % of an expanded track breaks swipe reveal.
    content.style.width = `${row.clientWidth || row.offsetWidth}px`;
  }
  syncContentWidth();
  queueMicrotask(syncContentWidth);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncContentWidth).observe(row);
  }

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let swiping = false;
  let longTimer = null;
  let longFired = false;

  function clearLong() {
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = null;
    }
  }

  content.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    syncContentWidth();
    startX = e.clientX;
    startY = e.clientY;
    dx = track.classList.contains('is-open') ? -SWIPE_W : 0;
    swiping = false;
    longFired = false;
    clearLong();
    longTimer = setTimeout(() => {
      longFired = true;
      toggleSelect(service.name);
      setState({ focusIndex: index });
      if (navigator.vibrate) navigator.vibrate(12);
    }, LONG_MS);
    try {
      content.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  content.addEventListener('pointermove', (e) => {
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!swiping && Math.abs(mx) < 10 && Math.abs(my) < 10) return;
    if (!swiping && Math.abs(my) > Math.abs(mx)) {
      clearLong();
      return;
    }
    clearLong();
    swiping = true;
    const base = track.classList.contains('is-open') ? -SWIPE_W : 0;
    dx = Math.min(0, Math.max(-SWIPE_W, base + mx));
    track.style.transition = 'none';
    track.style.transform = `translateX(${dx}px)`;
  });

  content.addEventListener('pointerup', () => {
    clearLong();
    track.style.transition = '';
    if (longFired) return;
    if (swiping) {
      if (dx < -SWIPE_W / 2) openSwipe(track);
      else resetSwipe(track);
      return;
    }
    if (track.classList.contains('is-open')) {
      resetSwipe(track);
      return;
    }
    setState({ focusIndex: index });
    onOpen?.(service);
  });

  content.addEventListener('pointercancel', () => {
    clearLong();
    track.style.transition = '';
    resetSwipe(track);
  });

  return row;
}

function openSwipe(track) {
  if (openTrack && openTrack !== track) resetSwipe(openTrack);
  openTrack = track;
  track.style.transform = `translateX(-${SWIPE_W}px)`;
  track.classList.add('is-open');
  const actions = track.querySelector('.mobile-row-actions');
  if (actions) actions.removeAttribute('aria-hidden');
}

function resetSwipe(track) {
  if (!track) return;
  track.style.transform = 'translateX(0)';
  track.classList.remove('is-open');
  if (openTrack === track) openTrack = null;
  const actions = track.querySelector('.mobile-row-actions');
  if (actions) actions.setAttribute('aria-hidden', 'true');
}
