import { h } from '../../lib/h.js';

/** daisyUI button classes. Extra utilities go in className. */
export function buttonClass({ variant, size, square = false, className = '' } = {}) {
  const cls = ['btn'];
  if (variant) cls.push(`btn-${variant}`);
  if (size) cls.push(`btn-${size}`);
  if (square) cls.push('btn-square');
  if (className) cls.push(className);
  return cls.join(' ');
}

/** Shared button. variant: primary | secondary | ghost | outline | error. size: sm | xs. */
export function Button({ variant, size, square = false, className = '', type = 'button', ...rest }, ...children) {
  return h('button', { ...rest, type, className: buttonClass({ variant, size, square, className }) }, ...children);
}
