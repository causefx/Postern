import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

/** Editable list of open-path rules. Mutates `paths` in place; calls onChange after structural edits. */
export function OpenPathsEditor({ paths, onChange }) {
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
      const pathInput = h('input', {
        className: 'input w-full min-w-0 font-mono text-[13px]',
        value: rule.path || '',
        placeholder: rule.match === 'regex' ? '^/webhooks/[^/]+$' : '/health',
        onInput: (e) => {
          rule.path = e.target.value;
          onChange?.();
        },
      });
      const removeBtn = h(
        'button',
        {
          type: 'button',
          className: 'btn btn-ghost btn-square btn-sm text-muted shrink-0',
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
          h('div', { className: 'open-path-main' }, pathInput, hint),
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
      Icon('plus', { size: 14 }),
      'Add path',
    ),
    h(
      'p',
      { className: 'm-0 text-xs text-muted leading-relaxed' },
      'Prefix matches the start of a path. Regex matches the whole path — anchor with ',
      h('code', { className: 'font-mono text-[12px]' }, '^…$'),
      '.',
    ),
  );
}
