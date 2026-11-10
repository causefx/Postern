import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { LoginIllustration } from './LoginIllustration.js';

export function BrandPanel() {
  return h(
    'aside',
    {
      className:
        'login-brand flex flex-col gap-2 px-12 py-10 max-md:px-6 max-md:py-7 bg-ink-raised border-r border-line max-md:border-r-0 max-md:border-b',
    },
    h(
      'div',
      { className: 'flex items-center gap-3' },
      h(
        'div',
        {
          className: 'size-10 rounded-[11px] bg-eggshell text-ink grid place-items-center',
          'aria-hidden': 'true',
        },
        Icon('door', { size: 22 }),
      ),
      h('span', { className: 'font-display text-xl font-bold' }, 'Postern'),
    ),
    h(
      'div',
      { className: 'flex-1 min-h-0 flex items-center justify-center py-7 max-md:max-h-64 max-md:py-4' },
      LoginIllustration(),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-3 max-w-[440px]' },
      h(
        'h2',
        {
          className:
            'm-0 font-display text-[34px] max-md:text-[26px] leading-tight font-semibold tracking-tight text-balance text-eggshell',
        },
        'A quiet side door for your private services.',
      ),
      h(
        'p',
        { className: 'm-0 text-[15px] leading-relaxed text-muted text-pretty' },
        'Callers reach your services through Postern. Their real keys never leave this server.',
      ),
    ),
  );
}
