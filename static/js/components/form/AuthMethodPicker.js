import { h } from '../../lib/h.js';
import { AUTH_METHODS } from '../../lib/authPresets.js';

export function AuthMethodPicker({ type, onChange }) {
  return h(
    'div',
    {
      className: 'auth-method-tabs',
      role: 'radiogroup',
      'aria-label': 'Auth method',
    },
    ...AUTH_METHODS.map((m) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': type === m.type,
          className: `auth-method-tab ${type === m.type ? 'auth-method-tab-active' : ''}`,
          onClick: () => onChange(m.type),
        },
        m.label,
      ),
    ),
  );
}
