import { h } from '../../lib/h.js';

/** Full-width Settings / Activity switch. */
export function SettingsTabs({ tab, count, onChange }) {
  return h(
    'div',
    { className: 'drawer-tabs', role: 'tablist', 'aria-label': 'Settings sections' },
    tabButton('settings', 'Settings', tab, onChange),
    tabButton('activity', 'Activity', tab, onChange, count),
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
