import { h } from '../../lib/h.js';
import { BrandPanel } from './BrandPanel.js';
import { LoginForm } from './LoginForm.js';
import { InsecureNotice } from './InsecureNotice.js';

export function LoginPage() {
  return h(
    'div',
    { className: 'login-page min-h-screen flex flex-wrap' },
    BrandPanel(),
    h(
      'main',
      { className: 'login-form-side flex flex-col justify-between items-center gap-8 px-6 py-10' },
      h('div', { 'aria-hidden': 'true' }),
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
