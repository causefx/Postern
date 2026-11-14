import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { api } from '../../api.js';
import { toast } from '../common/Toast.js';

function suggestName(name) {
  const suffix = '-2';
  const room = 32 - suffix.length;
  const stem = name.length + suffix.length > 32 ? name.slice(0, room).replace(/-+$/, '') : name;
  return `${stem}${suffix}`;
}

export function openDuplicateDialog({ service, trigger, onDuplicated }) {
  const err = h('p', { className: 'text-danger text-sm m-0 min-h-5' });
  const input = h('input', {
    className: 'input w-full font-mono',
    value: suggestName(service.name),
    'aria-label': 'New service name',
  });

  const body = h(
    'div',
    { className: 'flex flex-col gap-3' },
    h(
      'p',
      { className: 'm-0 text-sm text-muted leading-relaxed' },
      `Copies the upstream URL, credentials, access, and open paths from ${service.name}. The copy gets its own caller token.`,
    ),
    h('label', { className: 'label text-soft' }, 'New name'),
    input,
    err,
  );

  const footer = h(
    'div',
    { className: 'flex gap-2' },
    Button({ variant: 'ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
    Button(
      {
        onClick: async () => {
          err.textContent = '';
          try {
            const created = await api.duplicateService(service.name, input.value.trim());
            closeModal(dlg);
            toast.success('Service duplicated', { detail: `${service.name} copied as ${created.name}` });
            onDuplicated?.(created);
          } catch (e) {
            err.textContent = e.errors ? Object.values(e.errors).join(' · ') : e.message;
          }
        },
      },
      'Duplicate',
    ),
  );

  const dlg = Modal({ title: `Duplicate ${service.name}`, body, footer });
  openModal(dlg, trigger);
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return dlg;
}
