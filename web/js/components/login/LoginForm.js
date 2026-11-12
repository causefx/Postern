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
  const known = readLoginOptions();
  const oidcSlot = h('div', { className: 'flex flex-col gap-6', hidden: true });
  const blurb = h(
    'p',
    { className: 'mt-2 mb-0 text-[15px] leading-normal text-muted' },
    known ? '' : 'Sign in to manage services.',
  );
  const passwordBlock = h(
    'div',
    { className: 'password-block flex flex-col gap-6', hidden: !known || known.password === false },
    password,
    h(
      'label',
      { className: 'flex items-center gap-2.5 min-h-11 text-sm text-soft cursor-pointer' },
      h('input', {
        id: 'remember',
        type: 'checkbox',
        name: 'remember',
        value: '1',
        checked: true,
        className: 'checkbox checkbox-sm border-line-strong bg-sunken checked:bg-primary checked:text-primary-content checked:border-primary',
      }),
      'Keep me signed in on this device',
    ),
    submit,
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
      blurb,
    ),
    error,
    oidcSlot,
    passwordBlock,
  );

  const oidcError = oidcErrors[new URLSearchParams(location.search).get('error')];
  if (oidcError) {
    error.show(oidcError);
    history.replaceState(null, '', location.pathname);
  }
  if (known) applyLoginOptions(form, blurb, oidcSlot, passwordBlock, known);
  else {
    fetch('/admin/api/login', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((info) => {
        if (info) applyLoginOptions(form, blurb, oidcSlot, passwordBlock, info);
      })
      .catch(() => {
        passwordBlock.hidden = false;
      });
  }

  return form;
}

function readLoginOptions() {
  const raw = document.getElementById('login-options')?.textContent?.trim() || '';
  if (!raw || raw.startsWith('{{')) return null;
  try {
    const info = JSON.parse(raw);
    if (!info || typeof info !== 'object') return null;
    return info;
  } catch {
    return null;
  }
}

function applyLoginOptions(form, blurb, oidcSlot, passwordBlock, info) {
  const passwordOn = info.password !== false;
  const oidcOn = !!info.oidc;
  blurb.textContent = !oidcOn
    ? 'Enter the admin password to manage services.'
    : passwordOn
      ? 'Use your identity provider, or the admin password.'
      : 'Sign in with your identity provider.';
  passwordBlock.hidden = !passwordOn;
  if (!oidcOn) {
    oidcSlot.hidden = true;
    oidcSlot.replaceChildren();
    return;
  }
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
  oidcSlot.hidden = false;
  oidcSlot.replaceChildren(
    ...(passwordOn ? [sso, h('div', { className: 'text-center text-xs uppercase tracking-wide text-muted' }, 'or')] : [sso]),
  );
}
