import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { filteredServices, state, setState, isSelected, toggleSelect } from '../../state.js';
import { accessLabel, credBits } from '../../lib/serviceDisplay.js';
import { copyServiceToken, toggleServiceEnabled } from '../../lib/serviceActions.js';

const LONG_MS = 480;

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
    h(
      'span',
      {
        className: `access-pill shrink-0${service.access === 'upstream' ? ' access-upstream' : ' access-postern'}`,
      },
      accessLabel(service),
    ),
    Icon('chevron', { size: 16, className: 'text-muted -rotate-90 shrink-0' }),
  );

  const actions = h(
    'div',
    { className: 'mobile-row-actions' },
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
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'mobile-action mobile-action-power',
        'aria-label': service.enabled ? 'Turn off' : 'Turn on',
        onClick: (e) => {
          e.stopPropagation();
          toggleServiceEnabled(service);
          resetSwipe(track);
        },
      },
      Icon(service.enabled ? 'off' : 'on', { size: 18 }),
    ),
  );

  const track = h('div', { className: 'mobile-row-track' }, content, actions);
  const row = h('div', { className: 'mobile-row', dataset: { name: service.name } }, track);

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
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    swiping = false;
    longFired = false;
    clearLong();
    longTimer = setTimeout(() => {
      longFired = true;
      toggleSelect(service.name);
      setState({ focusIndex: index });
      if (navigator.vibrate) navigator.vibrate(12);
    }, LONG_MS);
    content.setPointerCapture?.(e.pointerId);
  });

  content.addEventListener('pointermove', (e) => {
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!swiping && Math.abs(mx) < 8 && Math.abs(my) < 8) return;
    if (Math.abs(my) > Math.abs(mx) && !swiping) {
      clearLong();
      return;
    }
    clearLong();
    swiping = true;
    dx = Math.min(0, Math.max(-120, mx));
    track.style.transform = `translateX(${dx}px)`;
  });

  content.addEventListener('pointerup', () => {
    clearLong();
    if (longFired) return;
    if (swiping) {
      if (dx < -56) openSwipe(track);
      else resetSwipe(track);
      return;
    }
    setState({ focusIndex: index });
    onOpen?.(service);
  });

  content.addEventListener('pointercancel', () => {
    clearLong();
    resetSwipe(track);
  });

  return row;
}

function openSwipe(track) {
  track.style.transform = 'translateX(-112px)';
  track.classList.add('is-open');
}

function resetSwipe(track) {
  track.style.transform = '';
  track.classList.remove('is-open');
}
