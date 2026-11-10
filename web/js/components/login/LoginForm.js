import { h } from '../../lib/h.js';
import { errorFromResponse, readBody } from '../../api.js';
import { Button } from '../common/Button.js';
import { LoginError } from './LoginError.js';
import { PasswordField } from './PasswordField.js';

const oidcErrors = {
  locked: 'Too many failed attempts. Try again in a minute.',
  denied: 'The sign-in was cancelled.',
  state: 'That sign-in expired. Try again.',
  failed: 'Could not sign in with the identity provider.',
  allow: 'That account is not allowed to manage Postern.',
};

export function LoginForm() {
  const error = LoginError();
  const password = PasswordField();
  const submit = Button(
    { type: 'submit', variant: 'primary', className: 'w-full h-12 text-[15px]' },
    'Sign in',
  );
  const oidcSlot = h('div', { className: 'flex flex-col gap-6', hidden: true });

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
    oidcSlot,
    h('div', { className: 'password-block flex flex-col gap-6' }, password,
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
    submit),
  );

  const oidcError = oidcErrors[new URLSearchParams(location.search).get('error')];
  if (oidcError) {
    error.show(oidcError);
    history.replaceState(null, '', location.pathname);
  }
  fetch('/admin/api/login', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((info) => {
      if (!info?.oidc) return;
      const blurb = form.querySelector('p');
      if (blurb) {
        blurb.textContent = info.password === false
          ? 'Sign in with your identity provider.'
          : 'Use your identity provider, or the admin password.';
      }
      if (info.password === false) {
        const block = form.querySelector('.password-block');
        if (block) block.hidden = true;
      }
      oidcSlot.hidden = false;
      const sso = Button(
        {
          type: 'button',
          className: 'btn-outline w-full h-12 text-[15px]',
          onClick: () => {
            const remember = form.querySelector('#remember')?.checked ? '1' : '0';
            location.assign(`/admin/oidc/start?remember=${remember}`);
          },
        },
        info.label || 'Sign in with SSO',
      );
      oidcSlot.replaceChildren(
        ...(info.password === false
          ? [sso]
          : [sso, h('div', { className: 'text-center text-xs uppercase tracking-wide text-muted' }, 'or')]),
      );
    })
    .catch(() => {});

  return form;
}
