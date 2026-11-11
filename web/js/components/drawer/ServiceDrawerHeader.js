import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { nameTile } from '../../lib/serviceDisplay.js';

/**
 * Service drawer chrome: tile + name, Live|Off, pager, close.
 * Phone: name and close on the first row; toggle and pager on the second.
 */
export function ServiceDrawerHeader({
  name,
  enabled,
  index,
  total,
  canPage,
  onToggle,
  onPrev,
  onNext,
  onClose,
}) {
  const tile = h('span', { className: 'svc-drawer-tile', 'aria-hidden': 'true' }, nameTile(name));
  const title = h('h2', { className: 'svc-drawer-title font-display m-0' }, name || 'New service');

  const liveBtn = h(
    'button',
    {
      type: 'button',
      className: 'svc-drawer-mode-btn',
      'aria-pressed': 'false',
      onClick: () => onToggle?.(true),
    },
    h('span', { className: 'status-dot', 'aria-hidden': 'true' }),
    'Live',
  );
  const offBtn = h(
    'button',
    {
      type: 'button',
      className: 'svc-drawer-mode-btn',
      'aria-pressed': 'false',
      onClick: () => onToggle?.(false),
    },
    h('span', { className: 'status-dot', 'aria-hidden': 'true' }),
    'Off',
  );
  const mode = h(
    'div',
    { className: 'svc-drawer-mode', role: 'group', 'aria-label': 'Service status' },
    liveBtn,
    offBtn,
  );

  const pagerLabel = h('span', { className: 'svc-drawer-pager-label' }, '— / —');
  const prevBtn = Button(
    {
      variant: 'ghost',
      size: 'sm',
      square: true,
      className: 'svc-drawer-pager-btn',
      'aria-label': 'Previous service',
      disabled: !canPage,
      onClick: () => onPrev?.(),
    },
    Icon('chevronUp', { size: 16 }),
  );
  const nextBtn = Button(
    {
      variant: 'ghost',
      size: 'sm',
      square: true,
      className: 'svc-drawer-pager-btn',
      'aria-label': 'Next service',
      disabled: !canPage,
      onClick: () => onNext?.(),
    },
    Icon('chevronDown', { size: 16 }),
  );
  const pager = h('div', { className: 'svc-drawer-pager' }, prevBtn, pagerLabel, nextBtn);

  const closeBtn = Button(
    {
      variant: 'ghost',
      size: 'sm',
      square: true,
      'aria-label': 'Close',
      onClick: () => onClose?.(),
    },
    Icon('close', { size: 16 }),
  );

  const el = h(
    'div',
    { className: 'svc-drawer-header' },
    h(
      'div',
      { className: 'svc-drawer-header-top' },
      h('div', { className: 'svc-drawer-identity min-w-0' }, tile, title),
      closeBtn,
    ),
    h('div', { className: 'svc-drawer-header-controls' }, mode, pager),
  );

  function update(next = {}) {
    if (next.name != null) {
      name = next.name;
      tile.textContent = nameTile(name);
      title.textContent = name || 'New service';
    }
    if (next.enabled != null) enabled = next.enabled;
    if (next.index != null) index = next.index;
    if (next.total != null) total = next.total;
    if (next.canPage != null) {
      canPage = next.canPage;
      prevBtn.disabled = !canPage;
      nextBtn.disabled = !canPage;
    }
    liveBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    offBtn.setAttribute('aria-pressed', enabled ? 'false' : 'true');
    mode.classList.toggle('is-live', !!enabled);
    mode.classList.toggle('is-off', !enabled);
    // Hide pager on create or when there is only one service to page.
    const showPager = !!canPage && total > 1 && index != null && index >= 0;
    pager.hidden = !showPager;
    pagerLabel.textContent = showPager ? `${index + 1} / ${total}` : '— / —';
  }

  update({ name, enabled, index, total, canPage });
  return { el, update };
}
