import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { CallerGateEditor } from './CallerGateEditor.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { copyText } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { api } from '../../api.js';

/**
 * Access tab: Postern-token card vs same-as-upstream card.
 */
export function AccessPanel({ draft, token, tokens = [], savedName, serviceLabel, onChange, onTokensUpdated }) {
  const wrap = h('div', {
    className: 'flex flex-col gap-3',
    role: 'radiogroup',
    'aria-label': 'How callers get in',
  });

  function paint() {
    const label = serviceLabel();
    const upstreamDisabled = isAuthNone(draft.auth);
    const postern = draft.access === 'postern';

    wrap.replaceChildren(
      h('span', { className: 'label-caps' }, 'How do callers get in?'),
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
        extra: postern ? posternExtras() : null,
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
        extra: !postern && !upstreamDisabled ? upstreamExtras(label) : null,
      }),
    );
  }

  function tokenRows() {
    if (tokens.length) return tokens;
    if (token) return [{ id: '', name: 'default', secret: token }];
    return [];
  }

  function tokenList() {
    const rows = tokenRows();
    if (!savedName || !rows.length) {
      return h(
        'p',
        { className: 'm-0 text-xs text-muted' },
        'A caller token is issued when you save this service.',
      );
    }
    const nameInput = h('input', {
      className: 'input flex-1 min-w-0',
      placeholder: 'Name, e.g. phone',
      'aria-label': 'New token name',
    });
    return h(
      'div',
      { className: 'flex flex-col gap-2' },
      ...rows.map((t) => {
        const masked = t.secret && t.secret.length > 8 ? t.secret.slice(0, 4) + '••••••••••••••••' : '••••••••';
        return h(
          'div',
          { className: t.paused ? 'token-field token-field-paused' : 'token-field' },
          h(
            'span',
            { className: `text-xs shrink-0 w-16 truncate ${t.paused ? 'text-muted' : 'text-cream-dim'}` },
            t.name || 'token',
          ),
          t.paused ? h('span', { className: 'text-[11px] font-semibold text-warn shrink-0' }, 'Paused') : null,
          h('code', { className: 'token-field-value' }, masked),
          Button(
            {
              variant: 'ghost',
              size: 'sm',
              square: true,
              className: 'token-field-btn',
              'aria-label': t.paused ? `Resume ${t.name || 'token'}` : `Pause ${t.name || 'token'}`,
              'aria-pressed': t.paused ? 'true' : 'false',
              title: t.paused ? 'Resume' : 'Pause',
              disabled: !t.id,
              onClick: async (e) => {
                const button = e.currentTarget;
                if (!t.id || button.disabled) return;
                button.disabled = true;
                try {
                  const updated = await api.setTokenPaused(savedName, t.id, !t.paused);
                  showToast(t.paused ? `Resumed ${t.name || 'token'}` : `Paused ${t.name || 'token'}`);
                  onTokensUpdated?.(updated);
                } catch (err) {
                  showToast(err.message, 'error');
                  if (button.isConnected) button.disabled = false;
                }
              },
            },
            Icon(t.paused ? 'play' : 'pause', { size: 15 }),
          ),
          Button(
            {
              variant: 'ghost',
              size: 'sm',
              square: true,
              className: 'token-field-btn',
              'aria-label': `Copy ${t.name || 'token'}`,
              title: 'Copy',
              onClick: async () => {
                try {
                  await copyText(t.secret);
                  showToast('Token copied');
                } catch {
                  showToast('Copy failed', 'error');
                }
              },
            },
            Icon('copy', { size: 15 }),
          ),
          Button(
            {
              variant: 'ghost',
              size: 'sm',
              square: true,
              className: 'token-field-btn',
              'aria-label': `Rotate ${t.name || 'token'}`,
              title: 'Rotate',
              onClick: async () => {
                try {
                  const updated = t.id
                    ? await api.rotateTokenId(savedName, t.id)
                    : await api.rotateToken(savedName);
                  showToast(`Rotated ${t.name || 'token'}`);
                  onTokensUpdated?.(updated);
                } catch (e) {
                  showToast(e.message, 'error');
                }
              },
            },
            Icon('rotate', { size: 15 }),
          ),
          Button(
            {
              variant: 'ghost',
              size: 'sm',
              square: true,
              className: 'token-field-btn',
              'aria-label': `Revoke ${t.name || 'token'}`,
              title: 'Revoke',
              disabled: rows.length < 2,
              onClick: async () => {
                if (rows.length < 2 || !t.id) return;
                if (!confirm(`Revoke ${t.name}? Callers using it will get 401.`)) return;
                try {
                  const updated = await api.deleteToken(savedName, t.id);
                  showToast(`Revoked ${t.name}`);
                  onTokensUpdated?.(updated);
                } catch (e) {
                  showToast(e.message, 'error');
                }
              },
            },
            Icon('close', { size: 15 }),
          ),
        );
      }),
      h(
        'div',
        { className: 'flex gap-2 items-center' },
        nameInput,
        Button(
          {
            size: 'sm',
            className: 'shrink-0',
            onClick: async () => {
              try {
                const updated = await api.addToken(savedName, nameInput.value.trim());
                nameInput.value = '';
                showToast('Token added');
                onTokensUpdated?.(updated);
              } catch (e) {
                showToast(e.message, 'error');
              }
            },
          },
          'Add',
        ),
      ),
    );
  }

  function posternExtras() {
    return h(
      'div',
      { className: 'flex flex-col gap-3 mt-1' },
      tokenList(),
      CallerGateEditor({
        gate: draft.gate,
        onChange: () => onChange?.(),
      }),
    );
  }

  function upstreamExtras(label) {
    return h(
      'div',
      { className: 'flex flex-col gap-2 mt-1' },
      h('span', { className: 'text-[13px] font-semibold text-cream-dim' }, 'Token'),
      tokenList(),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        `Rotating won't lock out callers who were given the real ${capitalize(label)} key.`,
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
