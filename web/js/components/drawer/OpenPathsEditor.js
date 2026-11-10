import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';

/** Editable list of open-path rules. Mutates `paths` in place; calls onChange after structural edits. */
export function OpenPathsEditor({ paths, onChange, errors }) {
  const list = h('div', { className: 'flex flex-col gap-2' });

  function redraw() {
    list.replaceChildren();
    paths.forEach((rule, i) => {
      const isRegex = rule.match === 'regex';
      const matchSel = h(
        'select',
        {
          className: 'auth-row-select w-auto max-w-none shrink-0',
          onChange: (e) => {
            rule.match = e.target.value;
            redraw();
            onChange?.();
          },
        },
        h('option', { value: 'prefix', selected: !isRegex }, 'Prefix'),
        h('option', { value: 'regex', selected: isRegex }, 'Regex'),
      );
      const pathError = (errors && (errors[`openPaths.${i}.path`] || errors[`openPaths.${i}.match`])) || '';
      const pathInput = h('input', {
        className: `input w-full min-w-0 font-mono text-[13px]${pathError ? ' input-error' : ''}`,
        value: rule.path || '',
        placeholder: rule.match === 'regex' ? '^/webhooks/[^/]+$' : '/health',
        'aria-invalid': pathError ? 'true' : 'false',
        onInput: (e) => {
          rule.path = e.target.value;
          onChange?.();
        },
      });
      const removeBtn = Button(
        {
          variant: 'ghost',
          size: 'sm',
          square: true,
          className: 'text-muted shrink-0',
          'aria-label': 'Remove path',
          title: 'Remove path',
          onClick: () => {
            paths.splice(i, 1);
            redraw();
            onChange?.();
          },
        },
        Icon('close', { size: 14 }),
      );
      const hint =
        rule.path && !isRegex
          ? h(
              'p',
              { className: 'm-0 text-xs text-muted leading-relaxed' },
              'Opens ',
              h('span', { className: 'font-mono' }, rule.path.startsWith('/') ? rule.path : `/${rule.path}`),
              ' and anything under it.',
            )
          : null;

      list.append(
        h(
          'div',
          { className: 'open-path-row' },
          matchSel,
          h(
            'div',
            { className: 'open-path-main' },
            pathInput,
            pathError
              ? h('p', { className: 'm-0 text-xs text-danger-text leading-relaxed' }, pathError)
              : hint,
          ),
          removeBtn,
        ),
      );
    });
  }

  redraw();

  return h(
    'div',
    { className: 'flex flex-col gap-3' },
    list,
    Button(
      {
        size: 'sm',
        className: 'w-fit',
        onClick: () => {
          if (paths.length >= 20) return;
          paths.push({ match: 'prefix', path: '' });
          redraw();
          onChange?.();
        },
      },
      Icon('plus', { size: 14 }),
      'Add path',
    ),
    h(
      'p',
      { className: 'm-0 text-xs text-muted leading-relaxed' },
      'Prefix matches the start of a path. A regex must start with ',
      h('code', { className: 'font-mono text-[12px]' }, '^'),
      '.',
    ),
  );
}
