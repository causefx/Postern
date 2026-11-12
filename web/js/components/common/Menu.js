import { h } from '../../lib/h.js';
import { Icon } from './Icon.js';

/**
 * Lightweight action menu.
 * items: [{ label, onSelect, danger?, disabled?, icon?, separator?, checked? }], or a function returning
 * that list, read each time the menu opens. An item with `checked` set is one of a set of choices and
 * the current one shows a tick.
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
    const list = typeof items === 'function' ? items() : items;
    menu.replaceChildren(
      ...list.map((item) => {
        if (item.separator) {
          return h('div', { className: 'menu-sep', role: 'separator' });
        }
        const choice = typeof item.checked === 'boolean';
        return h(
          'button',
          {
            type: 'button',
            role: choice ? 'menuitemradio' : 'menuitem',
            'aria-checked': choice ? String(item.checked) : null,
            className: `menu-item${item.danger ? ' is-danger' : ''}`,
            disabled: !!item.disabled,
            onClick: (e) => {
              e.stopPropagation();
              close();
              if (!item.disabled) item.onSelect?.();
            },
          },
          item.icon ? Icon(item.icon, { size: 14 }) : null,
          h('span', { className: 'menu-item-label' }, item.label),
          item.checked ? Icon('check', { size: 14, className: 'menu-item-check' }) : null,
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
