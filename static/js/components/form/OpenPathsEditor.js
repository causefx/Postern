import { h } from '../../lib/h.js';

/** Editable list of open-path rules. Mutates `paths` in place; calls onChange after structural edits. */
export function OpenPathsEditor({ paths, onChange }) {
  const list = h('div', { className: 'flex flex-col gap-2' });

  function redraw() {
    list.replaceChildren();
    if (!paths.length) {
      list.append(
        h('p', { className: 'm-0 text-sm text-muted' }, 'No open paths — every request needs a caller token.'),
      );
    }
    paths.forEach((rule, i) => {
      const isRegex = rule.match === 'regex';
      const matchSel = h(
        'select',
        {
          className: 'select select-bordered select-sm w-[7.5rem] shrink-0 bg-ink-raised border-slate',
          onChange: (e) => {
            rule.match = e.target.value;
            redraw();
            onChange?.();
          },
        },
        h('option', { value: 'prefix', selected: !isRegex }, 'Prefix'),
        h('option', { value: 'regex', selected: isRegex }, 'Regex'),
      );
      const pathInput = h('input', {
        className: 'input input-sm w-full font-mono text-[13px]',
        value: rule.path || '',
        placeholder: rule.match === 'regex' ? '^/webhooks/[^/]+$' : '/health',
        onInput: (e) => {
          rule.path = e.target.value;
        },
      });
      list.append(
        h(
          'div',
          { className: 'flex flex-wrap items-center gap-2' },
          matchSel,
          pathInput,
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm text-danger-text',
              onClick: () => {
                paths.splice(i, 1);
                redraw();
                onChange?.();
              },
            },
            'Remove',
          ),
        ),
      );
    });
  }

  redraw();

  return h(
    'div',
    { className: 'flex flex-col gap-3' },
    h(
      'p',
      { className: 'm-0 text-sm text-muted leading-relaxed' },
      'These paths skip the caller token. Postern still attaches the upstream credential. Prefix matches the start of the path (e.g. ',
      h('code', { className: 'font-mono text-[12px]' }, '/health'),
      '); regex matches the full path string (use ',
      h('code', { className: 'font-mono text-[12px]' }, '^…$'),
      ' to anchor).',
    ),
    list,
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm w-fit',
        onClick: () => {
          if (paths.length >= 20) return;
          paths.push({ match: 'prefix', path: '' });
          redraw();
          onChange?.();
        },
      },
      'Add path',
    ),
  );
}
