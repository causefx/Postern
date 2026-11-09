import { h } from '../../lib/h.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { rotateMany } from '../../lib/serviceActions.js';

export function openBulkRotateDialog({ names, trigger }) {
  const list = names.join(', ');
  const err = h('p', { className: 'text-danger-text text-sm m-0' });

  const footer = h('div', { className: 'flex gap-2' });
  const dlg = Modal({
    title: `Rotate ${names.length} token${names.length === 1 ? '' : 's'}?`,
    body: h(
      'div',
      { className: 'flex flex-col gap-3' },
      h(
        'p',
        { className: 'm-0 text-sm text-muted leading-relaxed' },
        'New caller tokens are issued and the current ones stop working immediately. Upstream credentials are not changed.',
      ),
      h('p', { className: 'm-0 text-sm font-mono text-cream-dim' }, list),
      err,
    ),
    footer,
  });

  footer.append(
    h('button', { type: 'button', className: 'btn btn-ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-primary',
        onClick: async () => {
          try {
            await rotateMany(names);
            closeModal(dlg);
          } catch (e) {
            err.textContent = e.message;
          }
        },
      },
      'Rotate',
    ),
  );

  openModal(dlg, trigger);
}
