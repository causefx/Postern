import { h } from '../../lib/h.js';

export function KeyboardHints({ drawerOpen = false }) {
  const hints = drawerOpen
    ? [
        { keys: ['J', 'K'], label: 'prev / next' },
        { keys: ['Esc'], label: 'close' },
      ]
    : [
        { keys: ['J', 'K'], label: 'move' },
        { keys: ['X'], label: 'select' },
        { keys: ['Space'], label: 'on/off' },
        { keys: ['C'], label: 'copy token' },
        { keys: ['Enter'], label: 'open' },
      ];

  return h(
    'footer',
    { className: 'kbd-footer desktop-only' },
    ...hints.map((hint) =>
      h(
        'span',
        { className: 'kbd-footer-item' },
        ...hint.keys.map((k) => h('kbd', { className: 'kbd-hint' }, k)),
        h('span', { className: 'text-muted text-[12px]' }, hint.label),
      ),
    ),
  );
}
