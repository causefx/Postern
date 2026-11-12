import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/** Error alert for a failed sign-in. Hidden when message is empty. */
export function LoginError() {
  const el = h(
    'div',
    {
      role: 'alert',
      hidden: true,
      className:
        'login-error flex gap-2.5 items-start rounded-[10px] border border-danger-line bg-danger-bg px-3.5 py-3 text-sm text-danger',
    },
    Icon('alert', { size: 16, className: 'mt-0.5 flex-none' }),
    h('span', { className: 'login-error-text' }, ''),
  );

  el.show = (message) => {
    el.querySelector('.login-error-text').textContent = message;
    el.hidden = !message;
  };

  return el;
}
