import { h } from '../../lib/h.js';

/**
 * Returns a <dialog class="modal">. Call openModal(dialog) / closeModal(dialog).
 * Focus returns to `trigger` on close when provided.
 */
export function Modal({ title, body, footer, wide = false }) {
  const box = h(
    'div',
    {
      className: `modal-box bg-base-200 border border-line-strong p-0 ${wide ? 'max-w-3xl' : 'max-w-lg'}`,
      style: { borderRadius: '18px', boxShadow: '0 30px 80px rgba(0,0,0,.55)' },
    },
    h(
      'div',
      { className: 'px-6 pt-6 pb-4' },
      title ? h('h2', { className: 'font-display text-[22px] font-bold tracking-tight m-0' }, title) : null,
    ),
    h('div', { className: 'px-6 pb-4 flex flex-col gap-4' }, body),
    footer
      ? h('div', { className: 'modal-action bg-space-sunk px-6 py-4 m-0 justify-end gap-2 border-t border-line' }, footer)
      : null,
  );

  const dlg = h(
    'dialog',
    {
      className: 'modal modal-bottom sm:modal-middle',
      onClick: (e) => {
        if (e.target === dlg) closeModal(dlg);
      },
      onCancel: (e) => {
        e.preventDefault();
        closeModal(dlg);
      },
    },
    box,
    h('form', { method: 'dialog', className: 'modal-backdrop' }, h('button', { type: 'submit', className: 'hidden' }, 'close')),
  );
  return dlg;
}

export function openModal(dlg, trigger) {
  dlg._trigger = trigger || document.activeElement;
  if (!dlg.isConnected) document.body.append(dlg);
  dlg.showModal();
  const focusable = dlg.querySelector('input,button,[href],select,textarea,[tabindex]:not([tabindex="-1"])');
  focusable?.focus();
}

export function closeModal(dlg) {
  if (dlg.open) dlg.close();
  const t = dlg._trigger;
  if (t && typeof t.focus === 'function') t.focus();
}
