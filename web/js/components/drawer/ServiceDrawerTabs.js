import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/**
 * Icon tab strip with native horizontal scroll, edge fades, page arrows, and dots.
 * Arrows/fades/dots hide when every tab fits.
 */
export function ServiceDrawerTabs({ tabs, activeId, onSelect, getBadge }) {
  const track = h('div', {
    className: 'svc-tabs-track',
    role: 'tablist',
    'aria-label': 'Service settings',
    tabindex: '0',
  });
  const dots = h('div', { className: 'svc-tabs-dots', 'aria-hidden': 'true' });
  const fadeLeft = h('div', { className: 'svc-tabs-fade svc-tabs-fade-left', 'aria-hidden': 'true' });
  const fadeRight = h('div', { className: 'svc-tabs-fade svc-tabs-fade-right', 'aria-hidden': 'true' });
  const prevBtn = h(
    'button',
    {
      type: 'button',
      className: 'svc-tabs-arrow svc-tabs-arrow-prev',
      'aria-label': 'Show earlier tabs',
      onClick: () => scrollPage(-1),
    },
    Icon('chevron', { size: 14, className: 'rotate-90' }),
  );
  const nextBtn = h(
    'button',
    {
      type: 'button',
      className: 'svc-tabs-arrow svc-tabs-arrow-next',
      'aria-label': 'Show more tabs',
      onClick: () => scrollPage(1),
    },
    Icon('chevron', { size: 14, className: '-rotate-90' }),
  );

  const el = h(
    'div',
    { className: 'svc-tabs' },
    h('div', { className: 'svc-tabs-shell' }, prevBtn, fadeLeft, track, fadeRight, nextBtn),
    dots,
  );

  let active = activeId;
  const buttons = new Map();

  function badgeFor(id) {
    const n = getBadge?.(id) || 0;
    return n > 0 ? n : 0;
  }

  function paint() {
    buttons.clear();
    track.replaceChildren(
      ...tabs.map((t) => {
        const selected = active === t.id;
        const count = badgeFor(t.id);
        const badge = count
          ? h('span', { className: 'svc-tabs-badge', 'aria-hidden': 'true' }, String(count))
          : null;
        const btn = h(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: `svc-tab-${t.id}`,
            'aria-selected': selected ? 'true' : 'false',
            tabindex: selected ? '0' : '-1',
            'aria-label': count ? `${t.label}, ${count} open path${count === 1 ? '' : 's'}` : t.label,
            className: `svc-tabs-tab${selected ? ' is-active' : ''}${count ? ' has-badge' : ''}`,
            onClick: () => select(t.id, true),
          },
          Icon(t.icon, { size: 16 }),
          h('span', { className: 'svc-tabs-label' }, t.label),
          badge,
        );
        buttons.set(t.id, btn);
        return btn;
      }),
    );
    requestAnimationFrame(() => {
      syncOverflow();
      const cur = buttons.get(active);
      cur?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    });
  }

  function select(id, fromClick) {
    if (!tabs.some((t) => t.id === id)) return;
    active = id;
    for (const [tid, btn] of buttons) {
      const on = tid === active;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle('is-active', on);
    }
    const cur = buttons.get(active);
    cur?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    if (fromClick) cur?.focus();
    onSelect?.(active);
    syncOverflow();
  }

  function scrollMax() {
    return Math.max(0, track.scrollWidth - track.clientWidth);
  }

  function scrollPage(dir) {
    const pages = pageCount();
    if (pages <= 1) return;
    const next = Math.max(0, Math.min(pages - 1, pageIndex() + dir));
    const max = scrollMax();
    const target = pages === 1 ? 0 : (next / (pages - 1)) * max;
    track.scrollTo({ left: target, behavior: 'smooth' });
  }

  function pageCount() {
    const max = scrollMax();
    if (max <= 2 || track.clientWidth <= 0) return 1;
    return Math.max(2, Math.ceil(track.scrollWidth / track.clientWidth));
  }

  function pageIndex() {
    const max = scrollMax();
    const pages = pageCount();
    if (max <= 2 || pages <= 1) return 0;
    // Map actual scroll range onto pages so the last page lights up at the end.
    return Math.min(pages - 1, Math.round((track.scrollLeft / max) * (pages - 1)));
  }

  function hiddenBadgeSide() {
    let left = false;
    let right = false;
    for (const [id, btn] of buttons) {
      if (!badgeFor(id)) continue;
      const br = btn.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      if (br.right < tr.left + 4) left = true;
      if (br.left > tr.right - 4) right = true;
    }
    return { left, right };
  }

  function syncOverflow() {
    const max = scrollMax();
    const overflow = max > 2;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft >= max - 2;
    const hidden = hiddenBadgeSide();
    const showLeft = overflow && (!atStart || hidden.left);
    const showRight = overflow && (!atEnd || hidden.right);

    el.classList.toggle('has-overflow', overflow);
    el.classList.toggle('show-left', showLeft);
    el.classList.toggle('show-right', showRight);
    el.classList.toggle('badge-left', hidden.left);
    el.classList.toggle('badge-right', hidden.right);
    prevBtn.hidden = !showLeft;
    nextBtn.hidden = !showRight;
    prevBtn.disabled = atStart && !hidden.left;
    nextBtn.disabled = atEnd && !hidden.right;

    const pages = pageCount();
    if (!overflow || pages <= 1) {
      dots.replaceChildren();
      dots.hidden = true;
      return;
    }
    dots.hidden = false;
    const activePage = pageIndex();
    if (dots.childElementCount !== pages) {
      dots.replaceChildren(
        ...Array.from({ length: pages }, (_, i) =>
          h('span', { className: `svc-tabs-dot${i === activePage ? ' is-active' : ''}` }),
        ),
      );
      return;
    }
    for (let i = 0; i < dots.children.length; i++) {
      dots.children[i].classList.toggle('is-active', i === activePage);
    }
  }

  track.addEventListener('scroll', () => syncOverflow(), { passive: true });
  track.addEventListener('keydown', (e) => {
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      select(ids[Math.min(ids.length - 1, i + 1)], true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(ids[Math.max(0, i - 1)], true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      select(ids[0], true);
    } else if (e.key === 'End') {
      e.preventDefault();
      select(ids[ids.length - 1], true);
    }
  });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => syncOverflow()) : null;
  ro?.observe(track);

  paint();

  return {
    el,
    setActive(id) {
      select(id, false);
    },
    refresh() {
      paint();
    },
    destroy() {
      ro?.disconnect();
    },
  };
}
