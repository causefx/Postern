import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';

/** Editable list of open-path rules. Mutates `paths` in place; calls onChange after structural edits. */
export function OpenPathsEditor({ paths, onChange, errors }) {
  const list = h('div', { className: 'open-paths-list' });

  function normalizedPath(rule) {
    if (!rule.path) return '';
    return rule.path.startsWith('/') ? rule.path : `/${rule.path}`;
  }

  function hintNodes(rule) {
    const isRegex = rule.match === 'regex';
    const path = normalizedPath(rule);
    if (!path) return null;
    if (!isRegex) {
      return [
        'Matches ',
        h('span', { className: 'open-path-hint-path' }, path),
        ' and anything under it.',
      ];
    }
    if (!rule.path.startsWith('^')) {
      return ['Regex must start with ^ — matches only paths that fit this pattern.'];
    }
    return ['Matches any request path that fits this pattern.'];
  }

  function paintHint(el, rule) {
    const nodes = hintNodes(rule);
    if (!nodes) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    el.hidden = false;
    el.replaceChildren(...nodes);
  }

  function redraw() {
    list.replaceChildren();
    paths.forEach((rule, i) => {
      const isRegex = rule.match === 'regex';
      const matchSel = h(
        'select',
        {
          className: 'open-path-select',
          'aria-label': 'Match type',
          onChange: (e) => {
            rule.match = e.target.value;
            redraw();
            onChange?.();
          },
        },
        h('option', { value: 'prefix', selected: !isRegex }, 'Prefix'),
        h('option', { value: 'regex', selected: isRegex }, 'Regex'),
      );
      const pathError =
        (errors && (errors[`openPaths.${i}.path`] || errors[`openPaths.${i}.match`])) || '';
      const hint = h('p', { className: 'open-path-hint m-0', 'data-open-path-hint': '1' });
      paintHint(hint, rule);
      const pathInput = h('input', {
        className: `open-path-input${pathError ? ' input-error' : ''}`,
        value: rule.path || '',
        placeholder: rule.match === 'regex' ? '^/webhooks/[^/]+$' : '/health',
        'aria-label': 'Open path',
        'aria-invalid': pathError ? 'true' : 'false',
        onInput: (e) => {
          rule.path = e.target.value;
          paintHint(hint, rule);
          onChange?.();
        },
      });
      const removeBtn = Button(
        {
          variant: 'ghost',
          size: 'sm',
          square: true,
          className: 'open-path-remove text-muted',
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
              ? h('p', { className: 'm-0 text-xs text-danger leading-relaxed' }, pathError)
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
    { className: 'open-paths-editor' },
    list,
    h(
      'button',
      {
        type: 'button',
        className: 'btn-add-row',
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
      { className: 'open-paths-footnote m-0' },
      'Prefix matches the start of a path. A regex must start with ',
      h('code', { className: 'font-mono text-[12px]' }, '^'),
      '.',
    ),
  );
}
