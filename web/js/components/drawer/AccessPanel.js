import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { CallerGateEditor } from './CallerGateEditor.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { copyText } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { openRotateDialog } from '../dialogs/RotateTokenDialog.js';
import { setState, state } from '../../state.js';

/**
 * Access tab: Postern-token card vs same-as-upstream card.
 */
export function AccessPanel({ draft, token, savedName, serviceLabel, onChange, onTokenRotated }) {
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

  function tokenField() {
    if (!savedName || !token) {
      return h(
        'p',
        { className: 'm-0 text-xs text-muted' },
        'A caller token is issued when you save this service.',
      );
    }
    const masked = token.length > 8 ? token.slice(0, 4) + '••••••••••••••••' : '••••••••';
    return h(
      'div',
      { className: 'token-field' },
      h('code', { className: 'token-field-value' }, masked),
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          square: true,
          className: 'token-field-btn',
          'aria-label': 'Copy token',
          title: 'Copy',
          onClick: async () => {
            try {
              await copyText(token);
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
          'aria-label': 'Rotate token',
          title: 'Rotate…',
          onClick: () =>
            openRotateDialog({
              service: { name: savedName, token },
              onRotated: (updated) => {
                setState({
                  services: state.services.map((s) =>
                    s.name === savedName ? { ...s, token: updated.token } : s,
                  ),
                });
                onTokenRotated?.(updated.token);
                paint();
              },
            }),
        },
        Icon('rotate', { size: 15 }),
      ),
    );
  }

  function posternExtras() {
    return h(
      'div',
      { className: 'flex flex-col gap-3 mt-1' },
      tokenField(),
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
      tokenField(),
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
