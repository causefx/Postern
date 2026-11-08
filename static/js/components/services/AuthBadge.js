import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { authLabel } from '../../lib/authPreview.js';

export function AuthBadge({ auth }) {
  const label = authLabel(auth);
  const parts = label.split(' ');
  const method = parts[0];
  const rest = parts.slice(1).join(' ');
  return h(
    'span',
    { className: 'inline-flex items-center gap-1.5 text-[13px] text-muted min-w-0' },
    Icon('lock', { size: 14, className: 'text-denim' }),
    h('span', {}, method),
    rest ? h('span', { className: 'font-mono text-cream-dim truncate' }, rest) : null,
  );
}
