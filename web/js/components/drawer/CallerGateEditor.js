import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { DEFAULT_GATE_HEADER, DEFAULT_GATE_QUERY } from '../../lib/callerGate.js';

/**
 * Access-tab "Accept it as" rows for Postern-token gate.
 * Mutates `gate` in place; calls onChange.
 */
export function CallerGateEditor({ gate, onChange }) {
  const wrap = h('div', { className: 'gate-editor' });

  function bump() {
    redraw();
    onChange?.();
  }

  function soft() {
    onChange?.();
  }

  function redraw() {
    wrap.replaceChildren(
      h('span', { className: 'gate-editor-label' }, 'Accept it as'),
      checkRow({
        checked: !!gate.bearer,
        label: 'Bearer token',
        trailing: h('span', { className: 'gate-hint font-mono' }, 'Authorization: Bearer …'),
        onToggle: (v) => {
          gate.bearer = v;
          bump();
        },
      }),
      checkRow({
        checked: !!gate.header,
        label: 'Header',
        trailing: gate.header
          ? h('input', {
              className: 'input font-mono gate-name-input',
              value: gate.header.name || '',
              placeholder: DEFAULT_GATE_HEADER,
              onInput: (e) => {
                gate.header.name = e.target.value;
                soft();
              },
            })
          : null,
        onToggle: (v) => {
          gate.header = v ? { name: gate.header?.name || DEFAULT_GATE_HEADER } : null;
          bump();
        },
      }),
      checkRow({
        checked: !!gate.query,
        label: 'URL parameter',
        trailing: gate.query
          ? h('input', {
              className: 'input font-mono gate-name-input',
              value: gate.query.name || '',
              placeholder: DEFAULT_GATE_QUERY,
              onInput: (e) => {
                gate.query.name = e.target.value;
                soft();
              },
            })
          : null,
        onToggle: (v) => {
          gate.query = v ? { name: gate.query?.name || DEFAULT_GATE_QUERY } : null;
          bump();
        },
        warn: gate.query
          ? h(
              'p',
              { className: 'gate-warn' },
              Icon('warn', { size: 14, className: 'shrink-0' }),
              'Tokens in URLs can end up in logs and browser history.',
            )
          : null,
      }),
    );
  }

  function checkRow({ checked, label, trailing, onToggle, warn }) {
    return h(
      'div',
      { className: 'gate-row-wrap' },
      h(
        'label',
        { className: 'gate-row' },
        h('input', {
          type: 'checkbox',
          className: 'checkbox checkbox-sm border-line-strong shrink-0',
          checked,
          onChange: (e) => onToggle(e.target.checked),
        }),
        h('span', { className: 'gate-row-label' }, label),
        trailing ? h('div', { className: 'gate-row-trailing' }, trailing) : null,
      ),
      warn || null,
    );
  }

  redraw();
  return wrap;
}
