import { h } from '../../lib/h.js';
import { Icon } from './Icon.js';
import { MenuButton } from './Menu.js';
import { THEME_OPTIONS, getThemePreference, setThemePreference } from '../../lib/theme.js';

/** Icon button that opens Light / Dark / System. The icon shows the current choice. */
export function ThemeToggle() {
  const iconHost = h('span', { className: 'inline-flex' });

  function paint() {
    const current = THEME_OPTIONS.find((o) => o.id === getThemePreference());
    iconHost.replaceChildren(Icon(current.icon, { size: 16 }));
    wrap.querySelector('button').title = `Theme: ${current.label}`;
  }

  const wrap = MenuButton(
    {
      label: 'Theme',
      className: 'btn btn-outline btn-sm btn-square h-9 w-9',
      items: () =>
        THEME_OPTIONS.map((o) => ({
          label: o.label,
          icon: o.icon,
          checked: o.id === getThemePreference(),
          onSelect: () => {
            setThemePreference(o.id);
            paint();
          },
        })),
    },
    iconHost,
  );

  paint();
  return wrap;
}
