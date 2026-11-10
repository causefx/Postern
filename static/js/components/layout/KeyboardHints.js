import { h } from '../../lib/h.js';
import { state } from '../../state.js';

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

  const version = state.meta?.version
    ? h('span', { className: 'font-mono text-[12px] text-muted' }, `v${state.meta.version}`)
    : null;

  return h(
    'footer',
    { className: 'kbd-footer' },
    h(
      'div',
      { className: 'kbd-footer-hints desktop-only' },
      ...hints.map((hint) =>
        h(
          'span',
          { className: 'kbd-footer-item' },
          ...hint.keys.map((k) => h('kbd', { className: 'kbd-hint' }, k)),
          h('span', { className: 'text-muted text-[12px]' }, hint.label),
        ),
      ),
    ),
    version,
  );
}
