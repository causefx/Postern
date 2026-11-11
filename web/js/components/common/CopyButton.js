import { h } from '../../lib/h.js';
import { copyValue } from '../../lib/clipboard.js';
import { buttonClass } from './Button.js';
import { Icon } from './Icon.js';

export function CopyButton({
  text,
  label = 'Copy',
  ariaLabel,
  className = buttonClass({ variant: 'ghost', size: 'sm' }),
  icon = false,
  onCopied,
}) {
  const btn = h(
    'button',
    {
      type: 'button',
      className,
      'aria-label': ariaLabel || label,
      onClick: async () => {
        try {
          const value = typeof text === 'function' ? text() : text;
          await copyValue(value);
          const prev = btn.dataset.label || (icon ? '' : btn.textContent);
          if (!icon) {
            btn.dataset.label = prev || label;
            btn.textContent = 'Copied';
            clearTimeout(btn._t);
            btn._t = setTimeout(() => {
              btn.textContent = btn.dataset.label;
            }, 1400);
          } else {
            btn.replaceChildren(Icon('check', { size: 16 }));
            clearTimeout(btn._t);
            btn._t = setTimeout(() => {
              btn.replaceChildren(Icon('copy', { size: 16 }));
            }, 1400);
          }
          onCopied?.();
        } catch {
          /* toast already shown */
        }
      },
    },
    icon ? Icon('copy', { size: 16 }) : label,
  );
  return btn;
}
