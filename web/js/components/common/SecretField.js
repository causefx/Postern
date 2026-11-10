import { h } from '../../lib/h.js';
import { Icon } from './Icon.js';
import { Button, buttonClass } from './Button.js';
import { CopyButton } from './CopyButton.js';

export function SecretField({ value, masked = true, onToggle, showCopy = true }) {
  let revealed = !masked;
  const text = h('code', { className: 'flex-1 truncate text-cream-dim' }, revealed ? value : mask(value));
  const wrap = h('div', { className: 'secret-field' }, text);

  const eye = Button(
    {
      variant: 'ghost',
      size: 'sm',
      square: true,
      'aria-label': revealed ? 'Hide token' : 'Reveal token',
      onClick: () => {
        revealed = !revealed;
        text.textContent = revealed ? value : mask(value);
        eye.setAttribute('aria-label', revealed ? 'Hide token' : 'Reveal token');
        eye.replaceChildren(Icon(revealed ? 'eyeOff' : 'eye', { size: 16 }));
        onToggle?.(revealed);
      },
    },
    Icon('eye', { size: 16 }),
  );
  wrap.append(eye);
  if (showCopy) {
    wrap.append(
      CopyButton({
        text: value,
        icon: true,
        className: buttonClass({ variant: 'ghost', size: 'sm', square: true }),
        ariaLabel: 'Copy token',
      }),
    );
  }
  return wrap;
}

function mask(v) {
  if (!v) return '••••••••';
  if (v.length <= 8) return '••••••••';
  return v.slice(0, 4) + '••••' + v.slice(-4);
}
