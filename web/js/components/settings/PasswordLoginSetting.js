import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';

/** Admin password switch. Turning it off waits for a successful OIDC sign-in. */
export function PasswordLoginSetting({ allowed, oidc, tested, onChange, onTest }) {
  const off = oidc && !allowed;
  return h(
    'div',
    { className: 'settings-controls' },
    h(
      'label',
      { className: 'settings-switch' },
      h('span', {}, 'Allow admin password'),
      h('input', {
        type: 'checkbox',
        className: 'toggle toggle-sm',
        checked: oidc ? allowed : true,
        disabled: !oidc,
        onChange: (e) => onChange(e.target.checked),
      }),
    ),
    h(
      'p',
      { className: 'settings-detail' },
      oidc
        ? 'Turn this off to require the identity provider. The password stays on until a test sign-in succeeds and you save.'
        : 'OIDC is not configured, so the admin password stays on.',
    ),
    off
      ? h(
          'div',
          { className: 'settings-warn', role: 'status' },
          h(
            'p',
            {},
            tested
              ? 'This browser is signed in with the identity provider. Saving rejects the admin password. Restarting without the OIDC environment variables turns the password back on.'
              : 'Test a sign-in with the identity provider before saving. The admin password stays on until that succeeds.',
          ),
          tested
            ? null
            : Button({ size: 'sm', className: 'btn-outline', onClick: onTest }, 'Test sign-in'),
        )
      : null,
    h('p', { className: 'settings-field-name' }, 'settings.passwordLogin · default on'),
  );
}
