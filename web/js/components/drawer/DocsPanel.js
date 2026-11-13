import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { slugify } from '../../lib/slug.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { usageSnippet, usageSendOptions } from '../../lib/usageSnippet.js';
import { copyValue } from '../../lib/clipboard.js';
import { StatusBadge } from '../common/StatusBadge.js';
import { state } from '../../state.js';

/**
 * How to use tab: base URL, request examples, and status notes from the draft config.
 */
export function DocsPanel({ draft }) {
  const wrap = h('div', { className: 'flex flex-col gap-5' });
  let lang = 'curl';
  let sendAs = 'bearer';

  function publicBase() {
    const name = slugify(draft.name) || draft.name || '<name>';
    const origin = state.meta.publicOrigin || location.origin;
    return `${origin.replace(/\/$/, '')}/p/${name}/`;
  }

  function serviceLabel() {
    return slugify(draft.name) || draft.name || 'the service';
  }

  function sendOptions() {
    return usageSendOptions(draft);
  }

  function samplePath() {
    return `${publicBase()}api/…`;
  }

  function buildSnippet() {
    const url = samplePath();
    const opts = sendOptions();
    if (!opts.find((o) => o.id === sendAs) && opts[0]) sendAs = opts[0].id;
    return usageSnippet({ draft, lang, sendAs, url });
  }

  function statusLine(code, text) {
    return h(
      'div',
      { className: 'docs-status-row' },
      StatusBadge(code),
      h('span', { className: 'text-muted text-[13px]' }, text),
    );
  }

  function inlineCopyField(value, ariaLabel) {
    return h(
      'div',
      { className: 'copy-field' },
      h('input', {
        className: 'copy-field-value',
        type: 'text',
        readOnly: true,
        value,
        'aria-label': ariaLabel,
        onFocus: (e) => e.currentTarget.select(),
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'copy-field-btn',
          'aria-label': `Copy ${ariaLabel}`,
          onClick: async () => {
            try {
              await copyValue(value);
            } catch {
              /* toast already shown */
            }
          },
        },
        Icon('copy', { size: 14 }),
        'Copy',
      ),
    );
  }

  function codeBlockWithCopy(snippet) {
    return h(
      'div',
      { className: 'code-block-wrap' },
      h('pre', { className: 'code-block m-0' }, snippet),
      h(
        'button',
        {
          type: 'button',
          className: 'copy-field-btn code-block-copy',
          'aria-label': 'Copy snippet',
          onClick: async () => {
            try {
              await copyValue(snippet);
            } catch {
              /* toast already shown */
            }
          },
        },
        Icon('copy', { size: 14 }),
        'Copy',
      ),
    );
  }

  function openPathLine(p) {
    const path = p.path.startsWith('/') ? p.path : `/${p.path}`;
    const full = `${publicBase().replace(/\/$/, '')}${path}`;
    return h(
      'div',
      { className: 'docs-open-path' },
      h('span', { className: 'docs-open-method' }, 'GET'),
      h('span', { className: 'docs-open-url' }, full),
    );
  }

  function paint() {
    const base = publicBase();
    const opts = sendOptions();
    if (!opts.find((o) => o.id === sendAs) && opts[0]) sendAs = opts[0].id;
    const snippet = buildSnippet();
    const open = (draft.openPaths || []).filter((p) => (p.path || '').trim());

    const sections = [
      h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('span', { className: 'label-caps' }, 'Base URL'),
        inlineCopyField(base, 'Base URL'),
        h(
          'p',
          { className: 'm-0 text-xs text-muted leading-relaxed' },
          'Anything after it goes to ',
          serviceLabel(),
          ' unchanged — e.g. ',
          h('span', { className: 'font-mono' }, `${base}api/v3/…`),
          ' reaches its ',
          h('span', { className: 'font-mono' }, '/api/v3/…'),
          '.',
        ),
      ),
    ];

    if (opts.length) {
      sections.push(
        h(
          'div',
          { className: 'flex flex-col gap-2.5' },
          h('span', { className: 'label-caps' }, 'Make a request'),
          h(
            'div',
            { className: 'access-seg w-fit' },
            ...['curl', 'js', 'python'].map((id) =>
              h(
                'button',
                {
                  type: 'button',
                  className: `access-seg-btn${lang === id ? ' access-seg-active' : ''}`,
                  onClick: () => {
                    lang = id;
                    paint();
                  },
                },
                id === 'js' ? 'JavaScript' : id === 'python' ? 'Python' : 'curl',
              ),
            ),
          ),
          h('span', { className: 'text-xs text-muted' }, 'Send the token as'),
          h(
            'div',
            { className: 'access-seg flex-wrap' },
            ...opts.map((o) =>
              h(
                'button',
                {
                  type: 'button',
                  className: `access-seg-btn${sendAs === o.id ? ' access-seg-active' : ''}`,
                  onClick: () => {
                    sendAs = o.id;
                    paint();
                  },
                },
                o.label,
              ),
            ),
          ),
          codeBlockWithCopy(snippet),
          h(
            'p',
            { className: 'm-0 text-xs text-muted' },
            draft.access === 'postern'
              ? 'Replace $POSTERN_TOKEN with the token from the Access tab.'
              : 'Use the Postern token or the real upstream value in that place.',
          ),
        ),
      );
    }

    if (draft.access === 'postern' && !isAuthNone(draft.auth)) {
      sections.push(
        h(
          'div',
          { className: 'flex flex-col gap-1.5' },
          h('span', { className: 'label-caps' }, `In an app (nzb360, LunaSea…)`),
          h(
            'p',
            { className: 'm-0 text-[13px] text-muted leading-relaxed' },
            'If the app can only speak ',
            serviceLabel(),
            '’s own auth shape, switch Access to “Same as ',
            serviceLabel(),
            '”.',
          ),
        ),
      );
    }

    if (open.length) {
      sections.push(
        h(
          'div',
          { className: 'flex flex-col gap-2' },
          h('span', { className: 'label-caps' }, 'No token needed'),
          h('div', { className: 'docs-open-list' }, ...open.map((p) => openPathLine(p))),
          h(
            'p',
            { className: 'm-0 text-xs text-muted leading-relaxed' },
            'From the open paths in Advanced. The upstream credential is still added.',
          ),
        ),
      );
    }

    sections.push(
      h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('span', { className: 'label-caps' }, 'What callers might get back'),
        h(
          'div',
          { className: 'flex flex-col gap-2' },
          statusLine('401', 'Token missing, wrong, or expired.'),
          statusLine('403', 'Service switched off, or this caller token is paused.'),
          statusLine('502', `Postern couldn’t reach ${serviceLabel()} at its upstream URL.`),
        ),
      ),
    );

    wrap.replaceChildren(...sections);
  }

  paint();
  wrap._refresh = paint;
  return wrap;
}
