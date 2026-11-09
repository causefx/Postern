import { h } from '../../lib/h.js';
import { authMethodShort, callerPreview } from '../../lib/authPreview.js';
import { isAuthNone } from '../../lib/authPresets.js';

export function AccessModePicker({ access, auth, publicBase, onChange }) {
  const upstreamDisabled = isAuthNone(auth);
  const method = authMethodShort(auth);

  const modes = [
    {
      id: 'postern',
      title: 'Postern token',
      hint: 'Callers send Authorization: Bearer pst_…. The service’s credentials never leave Postern.',
    },
    {
      id: 'upstream',
      title: 'Same as the service',
      hint: `Callers use ${method}, exactly as if talking to the service directly. Accepts the Postern token or the real value.`,
    },
  ];

  const wrap = h('div', { className: 'flex flex-col gap-3' });

  wrap.append(
    h(
      'div',
      { className: 'grid gap-2 sm:grid-cols-2', role: 'radiogroup', 'aria-label': 'Caller access' },
      ...modes.map((m) => {
        const selected = access === m.id;
        const disabled = m.id === 'upstream' && upstreamDisabled;
        return h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': selected,
            disabled,
            className: `rounded-[12px] border px-4 py-3 text-left flex gap-3 items-start transition-colors ${
              selected ? 'border-eggshell/40 bg-space-raised' : 'border-line bg-ink-raised hover:border-slate'
            } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`,
            onClick: () => {
              if (!disabled) onChange(m.id);
            },
          },
          h(
            'span',
            {
              className: `mt-0.5 w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
                selected ? 'border-eggshell' : 'border-slate'
              }`,
              'aria-hidden': 'true',
            },
            selected ? h('span', { className: 'w-2 h-2 rounded-full bg-eggshell' }) : null,
          ),
          h(
            'span',
            { className: 'flex flex-col gap-1 min-w-0' },
            h('span', { className: 'font-semibold text-sm text-eggshell' }, m.title),
            h('span', { className: 'text-[13px] leading-relaxed text-muted' }, m.hint),
          ),
        );
      }),
    ),
  );

  if (upstreamDisabled) {
    wrap.append(
      h(
        'p',
        { className: 'm-0 text-xs text-muted' },
        'Turn on at least one upstream auth method first to use “Same as the service”.',
      ),
    );
  }

  if (access === 'upstream' && !upstreamDisabled) {
    wrap.append(
      h('span', { className: 'label-caps' }, 'What callers send to Postern'),
      h('pre', { className: 'code-block' }, callerPreview(auth, { publicBase })),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        'A caller only needs one of these. Postern checks it matches the Postern token or the stored value for that place; anything else gets 401. All stored values are then sent upstream.',
      ),
    );
  }

  return wrap;
}
