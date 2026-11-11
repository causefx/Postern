import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { MenuButton } from '../common/Menu.js';
import { CallerGateEditor } from './CallerGateEditor.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { copyValue } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { api } from '../../api.js';

/**
 * Access tab: mode cards, then shared Tokens list below.
 */
export function AccessPanel({ draft, token, tokens = [], savedName, serviceLabel, onChange, onTokensUpdated }) {
  const wrap = h('div', { className: 'flex flex-col gap-4' });
  let adding = false;

  function paint() {
    const label = serviceLabel();
    const upstreamDisabled = isAuthNone(draft.auth);
    const postern = draft.access === 'postern';

    wrap.replaceChildren(
      h('span', { className: 'field-label' }, 'How do callers get in?'),
      h(
        'div',
        {
          className: 'flex flex-col gap-3',
          role: 'radiogroup',
          'aria-label': 'How callers get in',
        },
        accessCard({
          selected: postern,
          title: 'Postern token',
          body: 'Callers use a token Postern issues. The upstream key never leaves the server.',
          onSelect: () => {
            if (draft.access === 'postern') return;
            draft.access = 'postern';
            paint();
            onChange?.();
          },
          extra: postern
            ? CallerGateEditor({
                gate: draft.gate,
                onChange: () => onChange?.(),
              })
            : null,
        }),
        accessCard({
          selected: !postern,
          title: `Same as ${label}`,
          body: upstreamDisabled
            ? `Add upstream credentials on Connection first — then callers can use ${label}'s own auth shape.`
            : `Callers use the upstream's own credential shape, with the Postern token or the real key. Works with apps that only speak ${label}.`,
          disabled: upstreamDisabled,
          onSelect: () => {
            if (upstreamDisabled || draft.access === 'upstream') return;
            draft.access = 'upstream';
            paint();
            onChange?.();
          },
        }),
      ),
      tokensSection(label),
    );
  }

  function tokenRows() {
    if (tokens.length) return tokens;
    if (token) return [{ id: '', name: 'default', secret: token }];
    return [];
  }

  async function pauseToken(t) {
    if (!t.id) return;
    try {
      const updated = await api.setTokenPaused(savedName, t.id, !t.paused);
      showToast(t.paused ? `Resumed ${t.name || 'token'}` : `Paused ${t.name || 'token'}`);
      onTokensUpdated?.(updated);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function rotateToken(t) {
    try {
      const updated = t.id ? await api.rotateTokenId(savedName, t.id) : await api.rotateToken(savedName);
      showToast(`Rotated ${t.name || 'token'}`);
      onTokensUpdated?.(updated);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function deleteToken(t, rows) {
    if (rows.length < 2 || !t.id) return;
    if (!confirm(`Delete token ${t.name}? Callers using it will get 401.`)) return;
    try {
      const updated = await api.deleteToken(savedName, t.id);
      showToast(`Deleted ${t.name}`);
      onTokensUpdated?.(updated);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function addToken(name) {
    try {
      const updated = await api.addToken(savedName, name);
      adding = false;
      showToast('Token added');
      onTokensUpdated?.(updated);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function newTokenControls() {
    if (!savedName) return null;
    if (!adding) {
      return h(
        'button',
        {
          type: 'button',
          className: 'btn-add-row',
          onClick: () => {
            adding = true;
            paint();
          },
        },
        Icon('plus', { size: 14 }),
        'New token',
      );
    }
    const nameInput = h('input', {
      className: 'input flex-1 min-w-0',
      placeholder: 'Name, e.g. phone',
      'aria-label': 'New token name',
    });
    return h(
      'div',
      { className: 'flex gap-2 items-center' },
      nameInput,
      Button(
        {
          size: 'sm',
          className: 'shrink-0',
          onClick: () => addToken(nameInput.value.trim()),
        },
        'Add',
      ),
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          className: 'shrink-0',
          onClick: () => {
            adding = false;
            paint();
          },
        },
        'Cancel',
      ),
    );
  }

  function tokensSection(label) {
    const rows = tokenRows();
    const head = h(
      'div',
      { className: 'flex items-center justify-between gap-2' },
      h('span', { className: 'label-caps' }, 'Tokens'),
      !adding ? newTokenControls() : null,
    );

    if (!savedName) {
      return h(
        'div',
        { className: 'flex flex-col gap-2' },
        head,
        h(
          'p',
          { className: 'm-0 text-xs text-muted' },
          'A caller token is issued when you save this service.',
        ),
      );
    }

    return h(
      'div',
      { className: 'flex flex-col gap-2' },
      head,
      adding ? newTokenControls() : null,
      ...rows.map((t) => {
        const masked =
          t.secret && t.secret.length > 8 ? `${t.secret.slice(0, 4)}••••••••••••••••` : '••••••••';
        return h(
          'div',
          { className: t.paused ? 'token-field token-field-paused' : 'token-field' },
          h('span', { className: 'token-field-name' }, t.name || 'token'),
          h(
            'span',
            {
              className: `token-status-chip${t.paused ? ' is-paused' : ' is-active'}`,
              title: t.paused ? 'Paused' : 'Active',
            },
            t.paused ? 'Paused' : 'Active',
          ),
          h('code', { className: 'token-field-value' }, masked),
          h(
            'button',
            {
              type: 'button',
              className: 'copy-field-btn',
              'aria-label': `Copy ${t.name || 'token'}`,
              title: 'Copy',
              onClick: async () => {
                try {
                  await copyValue(t.secret);
                } catch {
                  /* toast already shown */
                }
              },
            },
            Icon('copy', { size: 14 }),
            'Copy',
          ),
          MenuButton(
            {
              label: `More actions for ${t.name || 'token'}`,
              className: 'btn btn-ghost btn-sm btn-square token-field-btn',
              items: [
                {
                  label: t.paused ? 'Resume' : 'Pause',
                  icon: t.paused ? 'play' : 'pause',
                  disabled: !t.id,
                  onSelect: () => pauseToken(t),
                },
                {
                  label: 'Rotate…',
                  icon: 'rotate',
                  onSelect: () => rotateToken(t),
                },
                { separator: true },
                {
                  label: 'Delete token…',
                  icon: 'trash',
                  danger: true,
                  disabled: rows.length < 2 || !t.id,
                  onSelect: () => deleteToken(t, rows),
                },
              ],
            },
            Icon('more', { size: 15 }),
          ),
        );
      }),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        'Tokens work in both modes. Paused tokens get 403. Rotating won’t lock out callers who were given the real ',
        capitalize(label),
        ' key.',
      ),
    );
  }

  function accessCard({ selected, title, body, onSelect, extra, disabled }) {
    return h(
      'div',
      {
        role: 'radio',
        tabindex: disabled ? -1 : 0,
        'aria-checked': selected,
        'aria-disabled': disabled ? 'true' : 'false',
        className: `access-card${selected ? ' access-card-active' : ''}${disabled ? ' access-card-disabled' : ''}`,
        onClick: () => {
          if (!disabled) onSelect();
        },
        onKeyDown: (e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        },
      },
      h(
        'div',
        { className: 'flex items-start gap-3 text-left' },
        h('span', {
          className: `access-card-radio${selected ? ' access-card-radio-on' : ''}`,
          'aria-hidden': 'true',
        }),
        h(
          'div',
          { className: 'flex flex-col gap-1 min-w-0 flex-1' },
          h('span', { className: 'text-sm font-semibold text-eggshell' }, title),
          h('span', { className: 'text-[13px] text-muted leading-relaxed' }, body),
        ),
      ),
      extra
        ? h(
            'div',
            {
              className: 'access-card-extra',
              onClick: (e) => e.stopPropagation(),
              onKeyDown: (e) => e.stopPropagation(),
            },
            extra,
          )
        : null,
    );
  }

  paint();
  wrap._refresh = paint;
  return wrap;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
