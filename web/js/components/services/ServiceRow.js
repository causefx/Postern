import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { setState, isSelected, toggleSelect } from '../../state.js';
import { accessLabel, credBits, recentLabel, recentTitle, upstreamHost } from '../../lib/serviceDisplay.js';
import { copyServiceToken } from '../../lib/serviceActions.js';
import { getDrawerName, isDrawerDirty } from '../drawer/ServiceDrawer.js';

export function ServiceRow({ service, index, focused, onOpen }) {
  const selected = isSelected(service.name);
  const route = `/p/${service.name}/`;
  const host = upstreamHost(service.url);
  const bits = credBits(service.auth);
  const access = accessLabel(service);
  const editingHere = getDrawerName() === service.name;
  const showEdited = editingHere && isDrawerDirty();

  return h(
    'tr',
    {
      className: [
        'svc-tr',
        focused ? 'svc-tr-focus' : '',
        selected ? 'svc-tr-selected' : '',
        editingHere ? 'svc-tr-editing' : '',
        service.enabled ? '' : 'svc-tr-off',
      ]
        .filter(Boolean)
        .join(' '),
      dataset: { name: service.name, index: String(index) },
      onClick: (e) => {
        if (e.target.closest('input,button,a')) return;
        setState({ focusIndex: index });
        onOpen?.(service);
      },
    },
    h(
      'td',
      { className: 'svc-td svc-td-check' },
      h('input', {
        type: 'checkbox',
        className: 'svc-check',
        checked: selected,
        'aria-label': `Select ${service.name}`,
        onClick: (e) => e.stopPropagation(),
        onChange: () => {
          toggleSelect(service.name);
          setState({ focusIndex: index });
        },
      }),
    ),
    h(
      'td',
      { className: 'svc-td' },
      h(
        'span',
        { className: `status-pill${service.enabled ? ' status-live' : ' status-off'}` },
        h('span', { className: 'status-dot', 'aria-hidden': 'true' }),
        service.enabled ? 'Live' : 'Off',
      ),
    ),
    h(
      'td',
      { className: 'svc-td' },
      h(
        'span',
        { className: 'inline-flex items-center gap-2 min-w-0' },
        h('span', { className: 'svc-name' }, service.name),
        showEdited ? h('span', { className: 'edited-chip' }, 'edited') : null,
      ),
    ),
    h('td', { className: 'svc-td svc-col-route' }, h('span', { className: 'font-mono text-[13px] text-cream-dim' }, route)),
    h(
      'td',
      { className: 'svc-td' },
      h('span', { className: 'font-mono text-[13px] text-muted truncate block max-w-[220px]', title: service.url }, host),
    ),
    h(
      'td',
      { className: 'svc-td svc-col-recent' },
      h(
        'span',
        {
          className: 'font-mono text-[12px] text-muted whitespace-nowrap',
          'data-recent': service.name,
          title: recentTitle(service),
        },
        recentLabel(service) || '—',
      ),
    ),
    h(
      'td',
      { className: 'svc-td' },
      h(
        'span',
        {
          className: `access-pill${service.access === 'upstream' ? ' access-upstream' : ' access-postern'}`,
        },
        access,
      ),
    ),
    h(
      'td',
      { className: 'svc-td svc-col-creds' },
      h(
        'span',
        { className: 'cred-line font-mono text-[12px] text-cream-dim' },
        ...bits.flatMap((b, i) => (i ? [' · ', b] : [b])),
      ),
    ),
    h(
      'td',
      { className: 'svc-td svc-td-actions' },
      Button(
        {
          size: 'sm',
          className: 'gap-1.5',
          onClick: async (e) => {
            e.stopPropagation();
            await copyServiceToken(service);
          },
        },
        Icon('copy', { size: 14 }),
        'Copy token',
      ),
    ),
  );
}
