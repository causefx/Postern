import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { BrandPanel } from './BrandPanel.js';
import { LoginForm } from './LoginForm.js';
import { InsecureNotice } from './InsecureNotice.js';

function MobileLogo() {
  return h(
    'div',
    { className: 'login-mobile-logo flex items-center gap-3 w-full max-w-[380px]' },
    h(
      'div',
      {
        className: 'size-10 rounded-[11px] bg-eggshell text-ink grid place-items-center',
        'aria-hidden': 'true',
      },
      Icon('door', { size: 22 }),
    ),
    h('span', { className: 'font-display text-xl font-bold' }, 'Postern'),
  );
}

export function LoginPage() {
  return h(
    'div',
    { className: 'login-page min-h-screen flex flex-wrap' },
    BrandPanel(),
    h(
      'main',
      { className: 'login-form-side flex flex-col justify-between items-center gap-8 px-6 py-10' },
      MobileLogo(),
      LoginForm(),
      h(
        'div',
        {
          className:
            'w-full max-w-[380px] flex flex-wrap justify-between gap-2.5 text-[12.5px] text-muted',
        },
        h('span', { className: 'font-mono' }, location.host),
        InsecureNotice(),
      ),
    ),
  );
}
