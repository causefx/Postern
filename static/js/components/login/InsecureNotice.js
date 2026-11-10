import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/** Amber footer warning when the page is not served over HTTPS. */
export function InsecureNotice() {
  if (location.protocol === 'https:') return null;
  return h(
    'span',
    { className: 'flex items-center gap-1.5 text-warn' },
    Icon('warn', { size: 13, className: 'shrink-0' }),
    'Not encrypted — use HTTPS before signing in remotely',
  );
}
