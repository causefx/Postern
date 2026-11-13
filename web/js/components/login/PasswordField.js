import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';

export function PasswordField() {
  const input = h('input', {
    id: 'password',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    allowAutofill: true,
    required: true,
    'aria-describedby': 'password-hint',
    className:
      'input w-full h-12 pr-13 font-mono text-[15px] bg-sunken border-line-strong focus:border-muted',
  });

  const eyeHost = h('span', { className: 'grid place-items-center' }, Icon('eye', { size: 16 }));

  const reveal = Button(
    {
      variant: 'ghost',
      square: true,
      'aria-label': 'Show password',
      'aria-controls': 'password',
      'aria-pressed': 'false',
      className: 'absolute right-0.5 top-0.5 size-11 min-h-0 text-soft',
      onClick: () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        reveal.setAttribute('aria-pressed', String(show));
        reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        eyeHost.replaceChildren(Icon(show ? 'eyeOff' : 'eye', { size: 16 }));
        input.focus();
      },
    },
    eyeHost,
  );

  const root = h(
    'div',
    { className: 'flex flex-col gap-2' },
    h('label', { className: 'text-sm font-semibold text-soft', htmlFor: 'password' }, 'Admin password'),
    h('div', { className: 'relative' }, input, reveal),
    h(
      'span',
      { id: 'password-hint', className: 'text-[13px] leading-normal text-muted' },
      'Set with ',
      h('code', { className: 'font-mono text-soft' }, 'ADMIN_PASSWORD'),
      ' when Postern starts.',
    ),
  );

  root.input = input;
  root.setInvalid = (invalid) => {
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  return root;
}
