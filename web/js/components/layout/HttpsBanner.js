import { h } from '../../lib/h.js';
import { Button, buttonClass } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { state } from '../../state.js';

const KEY = 'postern.httpsBannerDismissed';

export function HttpsBanner() {
  if (state.meta.secure || localStorage.getItem(KEY) === '1') return null;

  const el = h(
    'div',
    {
      className: 'flex flex-wrap gap-3.5 items-center p-3.5 rounded-xl bg-warn/10 border border-warn/20',
      role: 'status',
    },
    Icon('warn', { size: 20, className: 'text-warn' }),
    h(
      'p',
      { className: 'm-0 flex-1 min-w-[280px] text-sm leading-relaxed text-warn' },
      'Postern is serving plain HTTP, so tokens travel unencrypted. Put a TLS proxy (Caddy, Traefik, nginx) in front before exposing port 8080.',
    ),
    h(
      'div',
      { className: 'flex gap-2' },
      h(
        'a',
        {
          href: 'https://github.com/search?q=postern+https+caddy&type=repositories',
          className: buttonClass({ size: 'sm', className: 'border-warn/35 text-warn bg-transparent' }),
          target: '_blank',
          rel: 'noopener',
        },
        'How to add HTTPS',
      ),
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            localStorage.setItem(KEY, '1');
            el.remove();
          },
        },
        'Dismiss',
      ),
    ),
  );
  return el;
}
