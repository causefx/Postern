import { h } from '../../lib/h.js';
import { errorFromResponse, readBody } from '../../api.js';
import { Button } from '../common/Button.js';
import { LoginError } from './LoginError.js';
import { PasswordField } from './PasswordField.js';

export function LoginForm() {
  const error = LoginError();
  const password = PasswordField();
  const submit = Button(
    { type: 'submit', variant: 'primary', className: 'w-full h-12 text-[15px]' },
    'Sign in',
  );

  const form = h(
    'form',
    {
      className: 'w-full max-w-[380px] flex flex-col gap-6',
      'aria-labelledby': 'signin-title',
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        error.show('');
        password.setInvalid(false);
        submit.setAttribute('aria-busy', 'true');
        submit.disabled = true;
        submit.textContent = 'Signing in…';
        try {
          const res = await fetch(`${location.protocol}//${location.host}/admin/api/login`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              password: password.input.value,
              remember: form.querySelector('#remember').checked,
            }),
          });
          const j = await readBody(res);
          if (!res.ok) {
            error.show(errorFromResponse(res, j, "That password isn't right. Try again.").message);
            password.setInvalid(true);
            password.input.focus();
            password.input.select();
            return;
          }
          location.replace('/admin/');
        } catch (ex) {
          error.show(ex.message || 'Sign in failed');
          password.setInvalid(true);
          password.input.focus();
        } finally {
          submit.removeAttribute('aria-busy');
          submit.disabled = false;
          submit.textContent = 'Sign in';
        }
      },
    },
    h(
      'div',
      {},
      h('h1', { id: 'signin-title', className: 'm-0 font-display text-3xl font-bold tracking-tight' }, 'Sign in'),
      h(
        'p',
        { className: 'mt-2 mb-0 text-[15px] leading-normal text-muted' },
        'Enter the admin password to manage services.',
      ),
    ),
    error,
    password,
    h(
      'label',
      { className: 'flex items-center gap-2.5 min-h-11 text-sm text-cream-dim cursor-pointer' },
      h('input', {
        id: 'remember',
        type: 'checkbox',
        name: 'remember',
        value: '1',
        checked: true,
        className: 'checkbox checkbox-sm border-slate bg-ink-raised checked:bg-eggshell checked:text-ink checked:border-eggshell',
      }),
      'Keep me signed in on this device',
    ),
    submit,
  );

  return form;
}
