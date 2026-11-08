import { h } from '../../lib/h.js';

export function BearerAuthFields({ auth, editing, onChange }) {
  return h(
    'fieldset',
    { className: 'fieldset p-0' },
    h('label', { className: 'label text-cream-dim' }, 'Token'),
    h('input', {
      type: 'password',
      className: 'input w-full font-mono',
      autocomplete: 'off',
      placeholder: editing ? '•••••••• (unchanged)' : '',
      value: auth.secret || '',
      onInput: (e) => onChange({ secret: e.target.value }),
    }),
  );
}
