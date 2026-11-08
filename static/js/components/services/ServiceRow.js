import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { CopyButton } from '../common/CopyButton.js';
import { AuthBadge } from './AuthBadge.js';
import { ServiceDetail } from './ServiceDetail.js';
import { state, setState } from '../../state.js';
import { api } from '../../api.js';
import { showToast } from '../common/Toast.js';

export function ServiceRow({ service, handlers }) {
  const open = state.openRow === service.name;
  const routeShort = `/p/${service.name}/`;
  const fullRoute = service.publicBase || `${location.origin}/p/${service.name}/`;

  const article = h(
    'article',
    { className: `card-svc ${service.enabled ? '' : 'opacity-90'}`, dataset: { name: service.name } },
  );

  const toggle = h('input', {
    type: 'checkbox',
    className: 'toggle',
    checked: service.enabled,
    'aria-label': service.enabled ? `Turn off ${service.name}` : `Turn on ${service.name}`,
    onChange: async (e) => {
      const next = e.target.checked;
      const prev = state.services.map((s) => (s.name === service.name ? { ...s, enabled: next } : s));
      setState({ services: prev });
      try {
        const updated = await api.setEnabled(service.name, next);
        setState({
          services: state.services.map((s) => (s.name === service.name ? updated : s)),
        });
      } catch (err) {
        e.target.checked = !next;
        setState({
          services: state.services.map((s) => (s.name === service.name ? { ...s, enabled: !next } : s)),
        });
        showToast(err.message, 'error');
      }
    },
  });

  let menuOpen = false;
  const menu = h('div', {
    className: 'absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-lg border border-line bg-base-200 p-1 shadow-lg hidden',
    role: 'menu',
  });

  const menuBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn btn-sm btn-ghost btn-square',
      'aria-label': `Actions for ${service.name}`,
      'aria-haspopup': 'menu',
      onClick: (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        menu.classList.toggle('hidden', !menuOpen);
      },
    },
    Icon('more', { size: 16 }),
  );

  menu.append(
    menuItem('Edit', () => handlers.onEdit(service)),
    menuItem('Rotate token', () => handlers.onRotate(service)),
    menuItem('Delete', () => handlers.onDelete(service), true),
  );

  const expandBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn btn-sm gap-1',
      'aria-expanded': open,
      onClick: () => setState({ openRow: open ? null : service.name }),
    },
    'Token & usage',
    h('span', { className: `chev ${open ? 'chev-open' : ''}` }, Icon('chevron', { size: 14 })),
  );

  const row = h(
    'div',
    { className: 'svc-row' },
    h(
      'div',
      { className: 'flex items-center gap-3.5 min-w-0' },
      toggle,
      h(
        'div',
        { className: 'flex flex-col gap-1 min-w-0' },
        h('span', { className: `font-display text-[17px] font-semibold ${service.enabled ? '' : 'text-muted'}` }, service.name),
        h(
          'span',
          {
            className: `badge badge-sm w-fit gap-1.5 ${service.enabled ? 'badge-soft badge-success' : 'badge-ghost'}`,
          },
          h('span', { className: 'w-1.5 h-1.5 rounded-full bg-current' }),
          service.enabled ? 'Live' : 'Off',
        ),
      ),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-1 min-w-0' },
      h('span', { className: 'cell-label' }, 'Public route'),
      h(
        'div',
        { className: 'flex items-center gap-1.5 min-w-0' },
        h('span', { className: 'font-mono text-[13px] text-cream-dim truncate' }, routeShort),
        CopyButton({ text: fullRoute, icon: true, className: 'btn btn-sm btn-ghost btn-square', ariaLabel: 'Copy public route' }),
      ),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-1 min-w-0 cell-wide' },
      h('span', { className: 'cell-label' }, 'Upstream'),
      h(
        'div',
        { className: 'flex items-center gap-2 min-w-0 text-muted' },
        Icon('arrow', { size: 14, className: 'text-denim' }),
        h('span', { className: 'font-mono text-[13px] truncate', title: service.url }, service.url),
      ),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-1 min-w-0' },
      h('span', { className: 'cell-label' }, 'Upstream auth'),
      AuthBadge({ auth: service.auth }),
      h(
        'span',
        { className: 'text-[11px] text-muted' },
        service.access === 'upstream' ? 'Gate: same as service' : 'Gate: Postern token',
      ),
    ),
    h(
      'div',
      { className: 'flex items-center justify-end gap-1 relative' },
      expandBtn,
      menuBtn,
      menu,
    ),
  );

  article.append(row);
  if (open) {
    article.append(
      ServiceDetail({
        service,
        onRotate: () => handlers.onRotate(service),
        onEdit: () => handlers.onEdit(service),
        onDelete: () => handlers.onDelete(service),
      }),
    );
  }

  document.addEventListener(
    'click',
    () => {
      if (menuOpen) {
        menuOpen = false;
        menu.classList.add('hidden');
      }
    },
    { once: true },
  );

  return article;
}

function menuItem(label, onClick, danger = false) {
  return h(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      className: `btn btn-sm btn-ghost justify-start w-full font-normal ${danger ? 'text-danger-text' : 'text-eggshell'}`,
      onClick: (e) => {
        e.stopPropagation();
        onClick();
      },
    },
    label,
  );
}
