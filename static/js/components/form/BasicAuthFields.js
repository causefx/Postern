import { h } from '../../lib/h.js';

export function BasicAuthFields({ auth, editing, onChange }) {
  return h(
    'div',
    { className: 'grid gap-3 sm:grid-cols-2' },
    h(
      'fieldset',
      { className: 'fieldset p-0' },
      h('label', { className: 'label text-cream-dim' }, 'Username'),
      h('input', {
        className: 'input w-full font-mono',
        value: auth.username || '',
        onInput: (e) => onChange({ username: e.target.value }),
      }),
    ),
    h(
      'fieldset',
      { className: 'fieldset p-0' },
      h('label', { className: 'label text-cream-dim' }, 'Password'),
      h('input', {
        type: 'password',
        className: 'input w-full font-mono',
        autocomplete: 'off',
        placeholder: editing ? '•••••••• (unchanged)' : '',
        value: auth.secret || '',
        onInput: (e) => onChange({ secret: e.target.value }),
      }),
    ),
  );
}
