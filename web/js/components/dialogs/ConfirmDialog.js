import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';

/**
 * Ask the user to confirm an action, in place of the browser's confirm().
 * Cancel comes first, so it has focus when the dialog opens. Escape, a click outside and Cancel all
 * answer false.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string|Node} [opts.body]
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.danger] the confirm button is red, for an action that loses something
 * @param {Element} [opts.trigger] gets focus back when the dialog closes
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, trigger } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (dlg.open) closeModal(dlg);
      resolve(ok);
    };

    const footer = h(
      'div',
      { className: 'flex flex-wrap gap-2 justify-end' },
      Button({ variant: 'ghost', onClick: () => finish(false) }, cancelLabel),
      Button({ variant: danger ? 'error' : 'primary', onClick: () => finish(true) }, confirmLabel),
    );

    const dlg = Modal({
      title,
      body: typeof body === 'string' ? h('p', { className: 'm-0 text-sm text-muted leading-relaxed' }, body) : body,
      footer,
    });
    dlg.addEventListener('close', () => finish(false));
    openModal(dlg, trigger);
  });
}
