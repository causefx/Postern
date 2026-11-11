import { h } from '../../lib/h.js';
import { statusToneClass } from '../../lib/serviceDisplay.js';

/** Shared HTTP status badge for Requests and How to use. */
export function StatusBadge(status) {
  const code = status == null || status === '' ? '—' : String(status);
  return h('span', { className: `status-badge ${statusToneClass(status)}` }, code);
}
