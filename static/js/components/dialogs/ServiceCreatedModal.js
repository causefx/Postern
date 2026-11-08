import { h } from '../../lib/h.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { CopyButton } from '../common/CopyButton.js';
import { SecretField } from '../common/SecretField.js';
import { authPreview } from '../../lib/authPreview.js';

export function openServiceCreated({ service, trigger, onAddAnother, onDone }) {
  const base = service.publicBase || `${location.origin}/p/${service.name}/`;
  let tab = 'curl';
  const exampleHost = h('div', {});

  function renderExample() {
    exampleHost.replaceChildren();
    if (tab === 'curl') {
      exampleHost.append(
        h('pre', { className: 'code-block' }, `curl -H "Authorization: Bearer ${service.token}" \\\n  ${base}`),
      );
    } else if (tab === 'js') {
      exampleHost.append(
        h(
          'pre',
          { className: 'code-block' },
          `fetch("${base}", {\n  headers: { Authorization: "Bearer ${service.token}" }\n})`,
        ),
      );
    } else {
      exampleHost.append(h('pre', { className: 'code-block' }, `Authorization: Bearer ${service.token}`));
    }
  }
  renderExample();

  const tabs = ['curl', 'js', 'header'].map((id) => {
    const label = id === 'js' ? 'JavaScript' : id === 'header' ? 'Header only' : 'curl';
    return h(
      'button',
      {
        type: 'button',
        className: `btn btn-sm ${tab === id ? 'btn-secondary' : 'btn-ghost'}`,
        onClick: () => {
          tab = id;
          tabs.forEach((b, i) => {
            const ids = ['curl', 'js', 'header'];
            b.className = `btn btn-sm ${tab === ids[i] ? 'btn-secondary' : 'btn-ghost'}`;
          });
          renderExample();
        },
      },
      label,
    );
  });

  const body = h(
    'div',
    { className: 'flex flex-col gap-4' },
    h('span', { className: 'label-caps' }, 'Caller token'),
    SecretField({ value: service.token, masked: false }),
    CopyButton({ text: service.token, label: 'Copy token', className: 'btn btn-primary w-fit' }),
    h('span', { className: 'label-caps' }, 'Public route'),
    h(
      'div',
      { className: 'flex items-center gap-2' },
      h('code', { className: 'font-mono text-sm text-cream-dim' }, base),
      CopyButton({ text: base, icon: true, className: 'btn btn-sm btn-ghost btn-square', ariaLabel: 'Copy route' }),
    ),
    h('span', { className: 'label-caps' }, 'Example request'),
    h('div', { className: 'flex gap-1' }, ...tabs),
    exampleHost,
    h(
      'p',
      { className: 'm-0 text-xs text-muted leading-relaxed' },
      'Everything after ',
      h('code', { className: 'font-mono' }, `/p/${service.name}/`),
      ' is passed through unchanged (including websockets and streams). Upstream credential: ',
      h('code', { className: 'font-mono' }, authPreview(service.auth, { hasSecret: service.auth?.hasSecret })),
      '.',
    ),
  );

  const footer = h(
    'div',
    { className: 'flex gap-2' },
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-ghost',
        onClick: () => {
          closeModal(dlg);
          onAddAnother?.();
        },
      },
      'Add another',
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-primary',
        onClick: () => {
          closeModal(dlg);
          onDone?.();
        },
      },
      'Done',
    ),
  );

  const dlg = Modal({ title: `${service.name} is live`, body, footer, wide: true });
  openModal(dlg, trigger);
  return dlg;
}
