import { h } from '../../lib/h.js';
import { copyText } from '../../lib/clipboard.js';
import { Icon } from './Icon.js';

export function CopyButton({ text, label = 'Copy', ariaLabel, className = 'btn btn-sm btn-ghost', icon = false, onCopied }) {
  const btn = h(
    'button',
    {
      type: 'button',
      className,
      'aria-label': ariaLabel || label,
      onClick: async () => {
        const value = typeof text === 'function' ? text() : text;
        await copyText(value);
        const prev = btn.dataset.label || (icon ? '' : btn.textContent);
        if (!icon) {
          btn.dataset.label = prev || label;
          btn.textContent = 'Copied';
          clearTimeout(btn._t);
          btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1400);
        } else {
          btn.replaceChildren(Icon('check', { size: 16 }));
          clearTimeout(btn._t);
          btn._t = setTimeout(() => { btn.replaceChildren(Icon('copy', { size: 16 })); }, 1400);
        }
        onCopied?.();
      },
    },
    icon ? Icon('copy', { size: 16 }) : label,
  );
  return btn;
}
