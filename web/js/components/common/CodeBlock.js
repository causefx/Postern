import { h } from '../../lib/h.js';
import { CopyButton } from './CopyButton.js';
import { buttonClass } from './Button.js';

export function CodeBlock({ text, showCopy = true }) {
  const pre = h('pre', { className: 'code-block flex-1' }, text);
  if (!showCopy) return pre;
  return h(
    'div',
    { className: 'relative' },
    pre,
    h(
      'div',
      { className: 'absolute top-2 right-2' },
      CopyButton({ text, label: 'Copy', className: buttonClass({ variant: 'ghost', size: 'sm' }) }),
    ),
  );
}
