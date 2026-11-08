import { h } from '../../lib/h.js';
import { AUTH_PRESETS } from '../../lib/authPresets.js';

export function AuthPresetChips({ auth, onPick }) {
  return h(
    'div',
    { className: 'flex flex-wrap items-center gap-1.5' },
    h('span', { className: 'text-xs font-semibold uppercase tracking-[.06em] text-muted mr-1' }, 'Presets'),
    ...AUTH_PRESETS.map((p) => {
      const active = isActive(auth, p);
      return h(
        'button',
        {
          type: 'button',
          className: `preset-chip ${active ? 'preset-chip-active' : ''}`,
          onClick: () => onPick({ type: p.type, name: p.name, secret: '', username: '' }),
        },
        p.label,
      );
    }),
  );
}

function isActive(auth, preset) {
  if (!auth) return false;
  if (auth.type !== preset.type) return false;
  if (preset.type === 'bearer' || preset.type === 'none') return true;
  return (auth.name || '') === (preset.name || '');
}
