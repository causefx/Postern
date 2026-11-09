import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { authLabel } from '../../lib/authPreview.js';
import { isAuthNone } from '../../lib/authPresets.js';

export function AuthBadge({ auth }) {
  if (isAuthNone(auth)) {
    return h(
      'span',
      { className: 'inline-flex items-center gap-1.5 text-[13px] text-muted min-w-0' },
      Icon('lock', { size: 14, className: 'text-denim' }),
      h('span', {}, 'None'),
    );
  }
  const bits = [];
  if (auth.header) bits.push(auth.header.name || 'X-Api-Key');
  if (auth.query) bits.push(`?${auth.query.name || 'apikey'}`);
  if (auth.authz?.kind === 'basic') bits.push('Basic');
  else if (auth.authz) bits.push('Bearer');
  return h(
    'span',
    {
      className: 'inline-flex items-center gap-1.5 text-[13px] text-muted min-w-0',
      title: authLabel(auth),
    },
    Icon('lock', { size: 14, className: 'text-denim' }),
    h('span', { className: 'font-mono text-cream-dim truncate' }, bits.join(' · ')),
  );
}
