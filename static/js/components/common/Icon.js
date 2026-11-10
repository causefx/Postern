import { h } from '../../lib/h.js';

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.5 10.5a3 3 0 0 0 4.2 4.2M7 7C4 8.5 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M14 6.2C13.4 6.1 12.7 6 12 6 5.5 6 2 12 2 12a18 18 0 0 0 3.2 3.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  warn: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17.5v.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  door: '<path d="M6 21V11a6 6 0 0 1 12 0v10"/><path d="M3 21h18"/><circle cx="12" cy="13" r="1.6"/><path d="M12 14.6V17"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  on: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/>',
  off: '<circle cx="12" cy="12" r="8"/>',
  power: '<path d="M12 2v10"/><path d="M6.3 6.3a7 7 0 1 0 11.4 0"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
};

export function Icon(name, { size = 16, className = '' } = {}) {
  return h('svg', {
    className: `shrink-0 ${className}`.trim(),
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    html: PATHS[name] || '',
  });
}
