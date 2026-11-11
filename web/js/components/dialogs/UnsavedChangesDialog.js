import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';

/**
 * Ask what to do with unsaved drawer edits.
 * @returns {Promise<'save'|'discard'|'cancel'>}
 */
export function askUnsavedChanges() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      if (dlg.open) closeModal(dlg);
      resolve(choice);
    };

    const footer = h(
      'div',
      { className: 'flex flex-wrap gap-2 justify-end' },
      Button({ variant: 'ghost', onClick: () => finish('cancel') }, 'Cancel'),
      Button({ onClick: () => finish('discard') }, 'Discard'),
      Button({ variant: 'primary', onClick: () => finish('save') }, 'Save'),
    );

    const dlg = Modal({
      title: 'Unsaved changes',
      body: h(
        'p',
        { className: 'm-0 text-sm text-muted leading-relaxed' },
        'Save your edits, discard them, or cancel and keep editing.',
      ),
      footer,
    });
    dlg.addEventListener('close', () => finish('cancel'));
    openModal(dlg);
  });
}
