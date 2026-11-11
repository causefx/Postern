import { h } from '../../lib/h.js';
import { Icon } from './Icon.js';

/**
 * Lightweight action menu.
 * items: [{ label, onSelect, danger?, disabled?, icon?, separator? }]
 */
export function MenuButton({ label = 'More actions', className = '', items = [] }, triggerChild) {
  const menu = h('div', {
    className: 'menu-popover',
    role: 'menu',
    hidden: true,
  });
  const btn = h(
    'button',
    {
      type: 'button',
      className: className || 'btn btn-ghost btn-sm btn-square',
      'aria-label': label,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick: (e) => {
        e.stopPropagation();
        toggle();
      },
    },
    triggerChild,
  );
  const wrap = h('div', { className: 'menu-wrap' }, btn, menu);

  function close() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onDoc(e) {
    if (!wrap.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      btn.focus();
    }
  }

  function open() {
    menu.replaceChildren(
      ...items.map((item) => {
        if (item.separator) {
          return h('div', { className: 'menu-sep', role: 'separator' });
        }
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: `menu-item${item.danger ? ' is-danger' : ''}`,
            disabled: !!item.disabled,
            onClick: (e) => {
              e.stopPropagation();
              close();
              if (!item.disabled) item.onSelect?.();
            },
          },
          item.icon ? Icon(item.icon, { size: 14 }) : null,
          h('span', {}, item.label),
        );
      }),
    );
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  }

  function toggle() {
    if (menu.hidden) open();
    else close();
  }

  return wrap;
}
