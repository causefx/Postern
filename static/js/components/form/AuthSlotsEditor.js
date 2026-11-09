import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { AUTH_PRESETS, presetMatches } from '../../lib/authPresets.js';

/**
 * Multi-slot upstream auth editor (header / query / authz).
 * Mutates `auth` in place; calls onChange after structural edits.
 */
export function AuthSlotsEditor({ auth, editing, onChange }) {
  const wrap = h('div', { className: 'flex flex-col gap-3' });

  function bump() {
    redraw();
    onChange?.();
  }

  function soft() {
    // Value/name typing: refresh parent preview without remounting inputs.
    onChange?.();
  }

  function redraw() {
    wrap.replaceChildren(
      h(
        'div',
        { className: 'flex flex-wrap items-center gap-2' },
        h('span', { className: 'label-caps' }, 'Fill in for'),
        ...AUTH_PRESETS.map((p) => {
          const active = presetMatches(auth, p);
          return h(
            'button',
            {
              type: 'button',
              className: `preset-chip${active ? ' preset-chip-active' : ''}`,
              onClick: () => {
                auth.header = p.auth.header ? { ...p.auth.header, secret: auth.header?.secret || '' } : null;
                auth.query = p.auth.query ? { ...p.auth.query, secret: auth.query?.secret || '' } : null;
                auth.authz = p.auth.authz ? { ...p.auth.authz, secret: auth.authz?.secret || '' } : null;
                bump();
              },
            },
            p.label,
          );
        }),
      ),
      headerCard(),
      queryCard(),
      authzCard(),
    );
  }

  function secretInput(slot, placeholder) {
    const input = h('input', {
      type: 'password',
      className: 'input w-full font-mono pr-11',
      autocomplete: 'off',
      placeholder: editing ? '•••••••• (unchanged)' : placeholder || '',
      value: slot.secret || '',
      onInput: (e) => {
        slot.secret = e.target.value;
        soft();
      },
    });
    const btn = h(
      'button',
      {
        type: 'button',
        className: 'btn btn-ghost btn-square btn-sm absolute right-1 top-1/2 -translate-y-1/2 text-denim',
        'aria-label': 'Show value',
        onClick: () => {
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          btn.setAttribute('aria-label', show ? 'Hide value' : 'Show value');
          btn.replaceChildren(Icon(show ? 'eyeOff' : 'eye', { size: 16 }));
        },
      },
      Icon('eye', { size: 16 }),
    );
    return h('div', { className: 'relative' }, input, btn);
  }

  function toggleCard({ on, title, hint, badge, fields, onToggle }) {
    return h(
      'div',
      {
        className: `rounded-[14px] border px-4 py-3.5 flex flex-col gap-3 ${
          on ? 'border-line-strong bg-space-raised' : 'border-line bg-ink-raised'
        }`,
      },
      h(
        'div',
        { className: 'flex items-start gap-3' },
        h('input', {
          type: 'checkbox',
          className: 'toggle toggle-sm mt-0.5',
          checked: on,
          onChange: (e) => onToggle(e.target.checked),
        }),
        h(
          'div',
          { className: 'flex-1 min-w-0 flex flex-col gap-0.5' },
          h('div', { className: 'font-semibold text-sm text-eggshell' }, title),
          h('p', { className: 'm-0 text-[13px] text-muted leading-relaxed' }, hint),
        ),
        h('span', { className: 'auth-slot-badge' }, badge),
      ),
      on ? h('div', { className: 'pl-10 flex flex-col gap-3' }, ...fields) : null,
    );
  }

  function headerCard() {
    const on = !!auth.header;
    return toggleCard({
      on,
      title: 'Request header',
      hint: 'Sent as a header on every request.',
      badge: `${auth.header?.name || 'X-Api-Key'}: …`,
      onToggle: (checked) => {
        auth.header = checked ? { name: auth.header?.name || 'X-Api-Key', secret: auth.header?.secret || '' } : null;
        bump();
      },
      fields: on
        ? [
            field(
              'Header name',
              h('input', {
                className: 'input w-full font-mono',
                value: auth.header.name || '',
                onInput: (e) => {
                  auth.header.name = e.target.value;
                  soft();
                },
              }),
            ),
            field('Value', secretInput(auth.header)),
          ]
        : [],
    });
  }

  function queryCard() {
    const on = !!auth.query;
    return toggleCard({
      on,
      title: 'URL parameter',
      hint: 'Added to the end of every request URL.',
      badge: `?${auth.query?.name || 'apikey'}=…`,
      onToggle: (checked) => {
        auth.query = checked ? { name: auth.query?.name || 'apikey', secret: auth.query?.secret || '' } : null;
        bump();
      },
      fields: on
        ? [
            field(
              'Parameter name',
              h('input', {
                className: 'input w-full font-mono',
                value: auth.query.name || '',
                onInput: (e) => {
                  auth.query.name = e.target.value;
                  soft();
                },
              }),
            ),
            field('Value', secretInput(auth.query)),
          ]
        : [],
    });
  }

  function authzCard() {
    const on = !!auth.authz;
    const kind = auth.authz?.kind === 'basic' ? 'basic' : 'bearer';
    const badge = kind === 'basic' ? 'Authorization: Basic …' : 'Authorization: Bearer …';
    const fields = [];
    if (on) {
      fields.push(
        h(
          'div',
          { className: 'auth-method-tabs' },
          h(
            'button',
            {
              type: 'button',
              className: `auth-method-tab${kind === 'bearer' ? ' auth-method-tab-active' : ''}`,
              onClick: () => {
                auth.authz.kind = 'bearer';
                auth.authz.username = '';
                bump();
              },
            },
            'Bearer token',
          ),
          h(
            'button',
            {
              type: 'button',
              className: `auth-method-tab${kind === 'basic' ? ' auth-method-tab-active' : ''}`,
              onClick: () => {
                auth.authz.kind = 'basic';
                bump();
              },
            },
            'Basic auth',
          ),
        ),
      );
      if (kind === 'basic') {
        fields.push(
          h(
            'div',
            { className: 'grid gap-3 sm:grid-cols-2' },
            field(
              'Username',
              h('input', {
                className: 'input w-full font-mono',
                value: auth.authz.username || '',
                onInput: (e) => {
                  auth.authz.username = e.target.value;
                  soft();
                },
              }),
            ),
            field('Password', secretInput(auth.authz)),
          ),
        );
      } else {
        fields.push(field('Token', secretInput(auth.authz)));
      }
    }
    return toggleCard({
      on,
      title: 'Authorization — Bearer or Basic auth',
      hint: 'The standard login header: a bearer token, or Basic auth with a username and password.',
      badge,
      onToggle: (checked) => {
        auth.authz = checked
          ? { kind: auth.authz?.kind || 'bearer', username: auth.authz?.username || '', secret: auth.authz?.secret || '' }
          : null;
        bump();
      },
      fields,
    });
  }

  function field(label, input) {
    return h('fieldset', { className: 'fieldset p-0' }, h('label', { className: 'label text-cream-dim' }, label), input);
  }

  redraw();
  return wrap;
}
