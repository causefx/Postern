import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { api } from '../../api.js';
import { toast } from '../common/Toast.js';

export function openDeleteDialog({ service, trigger, onDeleted }) {
  const err = h('p', { className: 'text-danger text-sm m-0' });
  const delBtn = Button(
    {
      variant: 'error',
      disabled: true,
      onClick: async () => {
        try {
          await api.deleteService(service.name);
          closeModal(dlg);
          onDeleted?.(service);
        } catch (e) {
          err.textContent = e.message;
          toast.error("Couldn't delete the service", { detail: e.message });
        }
      },
    },
    'Delete service',
  );

  const input = h('input', {
    className: 'input w-full font-mono',
    placeholder: service.name,
    'aria-label': `Type ${service.name} to confirm`,
    onInput: (e) => {
      delBtn.disabled = e.target.value !== service.name;
    },
  });

  const body = h(
    'div',
    { className: 'flex flex-col gap-3' },
    h(
      'p',
      { className: 'm-0 text-sm text-muted leading-relaxed' },
      `This removes the public route /p/${service.name}/, the caller token, and the stored upstream credential. The upstream service itself is untouched.`,
    ),
    h('label', { className: 'label text-soft' }, `Type ${service.name} to confirm`),
    input,
    err,
  );

  const footer = h(
    'div',
    { className: 'flex gap-2' },
    Button({ variant: 'ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
    delBtn,
  );

  const dlg = Modal({ title: `Delete ${service.name}?`, body, footer });
  openModal(dlg, trigger);
  return dlg;
}
