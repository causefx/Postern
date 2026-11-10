import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { deleteMany } from '../../lib/serviceActions.js';

export function openBulkDeleteDialog({ names, trigger }) {
  const phrase = 'DELETE';
  const err = h('p', { className: 'text-danger-text text-sm m-0' });
  const delBtn = Button(
    {
      variant: 'error',
      disabled: true,
      onClick: async () => {
        try {
          await deleteMany(names);
          closeModal(dlg);
        } catch (e) {
          err.textContent = e.message;
        }
      },
    },
    `Delete ${names.length} service${names.length === 1 ? '' : 's'}`,
  );

  const input = h('input', {
    className: 'input w-full font-mono',
    placeholder: phrase,
    'aria-label': `Type ${phrase} to confirm`,
    onInput: (e) => {
      delBtn.disabled = e.target.value !== phrase;
    },
  });

  const footer = h('div', { className: 'flex gap-2' }, 
    Button({ variant: 'ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
    delBtn,
  );

  const dlg = Modal({
    title: `Delete ${names.length} service${names.length === 1 ? '' : 's'}?`,
    body: h(
      'div',
      { className: 'flex flex-col gap-3' },
      h(
        'p',
        { className: 'm-0 text-sm text-muted leading-relaxed' },
        'This removes the Postern routes and tokens. Upstream services are not touched.',
      ),
      h('p', { className: 'm-0 text-sm font-mono text-cream-dim' }, names.join(', ')),
      h(
        'p',
        { className: 'm-0 text-sm text-muted' },
        'Type ',
        h('span', { className: 'font-mono text-eggshell' }, phrase),
        ' to confirm.',
      ),
      input,
      err,
    ),
    footer,
  });

  openModal(dlg, trigger);
}
