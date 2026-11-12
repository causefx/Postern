import { h } from '../../lib/h.js';
import { Button, buttonClass } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { SecretField } from '../common/SecretField.js';
import { CopyButton } from '../common/CopyButton.js';
import { api } from '../../api.js';
import { showToast } from '../common/Toast.js';

export function openRotateDialog({ service, trigger, onRotated }) {
  const err = h('p', { className: 'text-danger text-sm m-0' });

  const confirmBody = h(
    'div',
    { className: 'flex flex-col gap-3' },
    h(
      'p',
      { className: 'm-0 text-sm text-muted leading-relaxed' },
      'A new caller token is issued and the current one stops working straight away. Anything using the old token will get 401 until you update it.',
    ),
    h('p', { className: 'm-0 text-xs text-muted' }, 'The upstream credential is not changed.'),
    err,
  );

  const footer = h('div', { className: 'flex gap-2' });

  const dlg = Modal({
    title: `Rotate the token for ${service.name}?`,
    body: confirmBody,
    footer,
  });

  footer.append(
    Button({ variant: 'ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
    Button(
      {
        variant: 'primary',
        onClick: async () => {
          try {
            const updated = await api.rotateToken(service.name);
            confirmBody.replaceChildren(
              h('span', { className: 'label-caps' }, 'New caller token'),
              SecretField({ value: updated.token, masked: false }),
              CopyButton({
                text: updated.token,
                label: 'Copy token',
                className: buttonClass({ variant: 'primary', className: 'w-fit' }),
              }),
            );
            footer.replaceChildren(
              Button(
                {
                  variant: 'primary',
                  onClick: () => {
                    closeModal(dlg);
                    onRotated?.(updated);
                  },
                },
                'Done',
              ),
            );
            dlg.querySelector('h2').textContent = `New token for ${service.name}`;
          } catch (e) {
            err.textContent = e.message;
            showToast(e.message, 'error');
          }
        },
      },
      'Rotate token',
    ),
  );

  openModal(dlg, trigger);
  return dlg;
}
