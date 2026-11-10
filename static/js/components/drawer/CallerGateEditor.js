import { h } from '../../lib/h.js';
import { DEFAULT_GATE_HEADER, DEFAULT_GATE_QUERY } from '../../lib/callerGate.js';

/**
 * Multi-place Postern-token gate editor. Mutates `gate` in place; calls onChange.
 * Shape: { bearer: bool, header: {name}|null, query: {name}|null }
 */
export function CallerGateEditor({ gate, onChange }) {
  const wrap = h('div', { className: 'flex flex-col gap-2.5' });

  function bump() {
    redraw();
    onChange?.();
  }

  function soft() {
    onChange?.();
  }

  function redraw() {
    wrap.replaceChildren(
      h('span', { className: 'label-caps' }, 'Callers send the token as'),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        'Enable one or more places. A caller only needs one of these.',
      ),
      toggleRow({
        on: !!gate.bearer,
        title: 'Authorization — Bearer',
        badge: 'Authorization: Bearer …',
        onToggle: (checked) => {
          gate.bearer = checked;
          bump();
        },
      }),
      toggleRow({
        on: !!gate.header,
        title: 'Request header',
        badge: `${gate.header?.name || DEFAULT_GATE_HEADER}: …`,
        onToggle: (checked) => {
          gate.header = checked ? { name: gate.header?.name || DEFAULT_GATE_HEADER } : null;
          bump();
        },
        fields: gate.header
          ? [
              field(
                'Header name',
                h('input', {
                  className: 'input input-sm w-full font-mono',
                  value: gate.header.name || '',
                  placeholder: DEFAULT_GATE_HEADER,
                  onInput: (e) => {
                    gate.header.name = e.target.value;
                    soft();
                    // refresh badge without remounting input
                    const badge = wrap.querySelector('[data-gate-badge="header"]');
                    if (badge) badge.textContent = `${gate.header.name || DEFAULT_GATE_HEADER}: …`;
                  },
                }),
              ),
            ]
          : null,
        badgeKey: 'header',
      }),
      toggleRow({
        on: !!gate.query,
        title: 'URL parameter',
        badge: `?${gate.query?.name || DEFAULT_GATE_QUERY}=…`,
        onToggle: (checked) => {
          gate.query = checked ? { name: gate.query?.name || DEFAULT_GATE_QUERY } : null;
          bump();
        },
        fields: gate.query
          ? [
              field(
                'Parameter name',
                h('input', {
                  className: 'input input-sm w-full font-mono',
                  value: gate.query.name || '',
                  placeholder: DEFAULT_GATE_QUERY,
                  onInput: (e) => {
                    gate.query.name = e.target.value;
                    soft();
                    const badge = wrap.querySelector('[data-gate-badge="query"]');
                    if (badge) badge.textContent = `?${gate.query.name || DEFAULT_GATE_QUERY}=…`;
                  },
                }),
              ),
            ]
          : null,
        badgeKey: 'query',
      }),
    );
  }

  function toggleRow({ on, title, badge, onToggle, fields, badgeKey }) {
    return h(
      'div',
      {
        className: `rounded-[12px] border px-3.5 py-3 flex flex-col gap-2.5 ${
          on ? 'border-line-strong bg-space-raised' : 'border-line bg-ink-deep'
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
        h('div', { className: 'flex-1 min-w-0 font-semibold text-sm text-eggshell' }, title),
        h(
          'span',
          {
            className: 'auth-slot-badge',
            dataset: badgeKey ? { gateBadge: badgeKey } : undefined,
          },
          badge,
        ),
      ),
      on && fields?.length ? h('div', { className: 'pl-10 flex flex-col gap-2' }, ...fields) : null,
    );
  }

  function field(label, input) {
    return h('fieldset', { className: 'fieldset p-0' }, h('label', { className: 'label text-cream-dim text-xs' }, label), input);
  }

  redraw();
  return wrap;
}
