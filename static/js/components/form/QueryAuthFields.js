import { h } from '../../lib/h.js';

export function QueryAuthFields({ auth, editing, onChange }) {
  return h(
    'div',
    { className: 'grid gap-3 sm:grid-cols-2' },
    field('Parameter name', h('input', {
      className: 'input w-full font-mono',
      value: auth.name || 'apikey',
      onInput: (e) => onChange({ name: e.target.value }),
    })),
    field(
      'Value',
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

function field(label, input) {
  return h('fieldset', { className: 'fieldset p-0' }, h('label', { className: 'label text-cream-dim' }, label), input);
}
