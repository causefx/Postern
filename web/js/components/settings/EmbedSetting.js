import { h } from '../../lib/h.js';

/**
 * Which sites may show the admin UI in a frame. One site per line (commas and spaces work too).
 * Empty blocks embedding. The parent keeps the text and the parsed list; call `_set` on the returned
 * element to update the error and warning without rebuilding the field the person is typing in.
 */
export function EmbedSetting({ text, error, origins, onInput }) {
  const errorEl = h('p', { className: 'm-0 text-xs text-danger', role: 'alert' });
  const anyWarn = h(
    'div',
    { className: 'settings-warn', role: 'status' },
    h(
      'p',
      {},
      'Any website can embed the admin UI, which makes clickjacking possible. List the sites you use instead.',
    ),
  );

  const input = h('textarea', {
    className: 'input font-mono embed-origins',
    rows: '3',
    placeholder: 'https://dash.example.com\nhttp://192.168.1.10:3000',
    'aria-label': 'Sites allowed to embed the admin UI',
    spellcheck: 'false',
    value: text,
    onInput: (e) => onInput(e.target.value),
  });

  const root = h(
    'div',
    { className: 'settings-controls', 'data-embed': '1' },
    h(
      'p',
      { className: 'settings-detail' },
      'By default the admin UI refuses to be shown inside another page. To use it in a dashboard such as Organizr or Homepage, list that dashboard’s address here, one per line.',
    ),
    input,
    errorEl,
    anyWarn,
    h(
      'p',
      { className: 'settings-detail' },
      'Use the dashboard’s own address, for example ',
      h('code', { className: 'font-mono text-[12px]' }, 'https://dash.example.com'),
      ', with a port if it has one. ',
      h('code', { className: 'font-mono text-[12px]' }, '*.example.com'),
      ' matches subdomains, and ',
      h('code', { className: 'font-mono text-[12px]' }, '*'),
      ' on its own allows any site. Leave it empty to block embedding.',
    ),
    h(
      'p',
      { className: 'settings-detail' },
      'Signing in inside a frame needs the dashboard on the same domain as Postern, or Postern served over HTTPS. Browsers that block third-party cookies will not keep the session otherwise.',
    ),
    h('p', { className: 'settings-field-name' }, 'settings.embedOrigins · default none'),
  );

  root._set = ({ error: nextError, origins: nextOrigins }) => {
    errorEl.textContent = nextError || '';
    errorEl.hidden = !nextError;
    anyWarn.hidden = !(nextOrigins || []).includes('*');
    input.setAttribute('aria-invalid', nextError ? 'true' : 'false');
  };
  root._set({ error, origins });
  return root;
}
