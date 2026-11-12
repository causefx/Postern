import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { state, clearSelection } from '../../state.js';
import { setManyEnabled } from '../../lib/serviceActions.js';
import { openBulkRotateDialog } from '../dialogs/BulkRotateDialog.js';
import { openBulkDeleteDialog } from '../dialogs/BulkDeleteDialog.js';

export function BulkActionBar() {
  const names = state.selected;
  if (!names.length) return null;

  const selected = state.services.filter((s) => names.includes(s.name));
  const anyLive = selected.some((s) => s.enabled);
  const enableLabel = anyLive ? 'Turn off' : 'Turn on';
  const enableTarget = !anyLive;
  const label =
    names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

  return h(
    'div',
    { className: 'bulk-bar', role: 'region', 'aria-label': 'Bulk actions' },
    h(
      'div',
      { className: 'flex items-center gap-2 min-w-0 flex-1' },
      h('span', { className: 'font-semibold text-sm text-base-content whitespace-nowrap' }, `${names.length} selected`),
      h('span', { className: 'text-sm text-muted truncate' }, label),
    ),
    h(
      'div',
      { className: 'flex flex-wrap items-center gap-2 shrink-0' },
      Button({ size: 'sm', onClick: () => setManyEnabled(names, enableTarget) }, enableLabel),
      Button({ size: 'sm', onClick: () => openBulkRotateDialog({ names }) }, 'Rotate tokens'),
      Button({ variant: 'error', size: 'sm', onClick: () => openBulkDeleteDialog({ names }) }, 'Delete'),
      Button({ size: 'sm', onClick: () => clearSelection() }, 'Clear'),
    ),
  );
}
