import { h } from '../../lib/h.js';

export function NoneAuthNote() {
  return h(
    'p',
    { className: 'm-0 text-sm text-muted leading-relaxed' },
    'The upstream needs no credentials. Postern still requires the caller token on every request.',
  );
}
