import { h } from '../../lib/h.js';

/** Full-width Settings / Requests / Admin log switch. Requests is proxy traffic; Admin log is admin changes. */
export function SettingsTabs({ tab, count, onChange }) {
  return h(
    'div',
    { className: 'drawer-tabs', role: 'tablist', 'aria-label': 'Settings sections' },
    tabButton('settings', 'Settings', tab, onChange),
    tabButton('requests', 'Requests', tab, onChange),
    tabButton('activity', 'Admin log', tab, onChange, count),
  );
}

function tabButton(id, label, tab, onChange, count = 0) {
  const selected = tab === id;
  return h(
    'button',
    {
      type: 'button',
      role: 'tab',
      className: selected ? 'drawer-tab drawer-tab-active' : 'drawer-tab',
      'aria-selected': selected ? 'true' : 'false',
      onClick: () => onChange(id),
    },
    label,
    count > 0 ? h('span', { className: 'drawer-tab-badge' }, String(count)) : null,
  );
}
