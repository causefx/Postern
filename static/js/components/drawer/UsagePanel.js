import { h } from '../../lib/h.js';
import { slugify } from '../../lib/slug.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { defaultGate, isGateEmpty, DEFAULT_GATE_HEADER, DEFAULT_GATE_QUERY } from '../../lib/callerGate.js';
import { copyText } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { state } from '../../state.js';

/**
 * Usage tab: examples derived only from the current draft config.
 */
export function UsagePanel({ draft }) {
  const wrap = h('div', { className: 'flex flex-col gap-5' });
  let lang = 'curl';
  let sendAs = 'bearer';

  function publicBase() {
    const name = slugify(draft.name) || draft.name || savedFallback();
    const origin = state.meta.publicOrigin || location.origin;
    return `${origin.replace(/\/$/, '')}/p/${name}/`;
  }

  function savedFallback() {
    return '<name>';
  }

  function serviceLabel() {
    return slugify(draft.name) || draft.name || 'the service';
  }

  function gate() {
    if (draft.access !== 'postern') return null;
    return draft.gate && !isGateEmpty(draft.gate) ? draft.gate : defaultGate();
  }

  function sendOptions() {
    if (draft.access === 'upstream') {
      const opts = [];
      if (draft.auth?.header) opts.push({ id: 'up-header', label: draft.auth.header.name || 'X-Api-Key' });
      if (draft.auth?.query) opts.push({ id: 'up-query', label: `?${draft.auth.query.name || 'apikey'}` });
      if (draft.auth?.authz?.kind === 'basic') opts.push({ id: 'up-basic', label: 'Basic' });
      else if (draft.auth?.authz) opts.push({ id: 'up-bearer', label: 'Bearer' });
      return opts;
    }
    const g = gate();
    const opts = [];
    if (g.bearer) opts.push({ id: 'bearer', label: 'Bearer' });
    if (g.header) opts.push({ id: 'header', label: g.header.name || DEFAULT_GATE_HEADER });
    if (g.query) opts.push({ id: 'query', label: `?${g.query.name || DEFAULT_GATE_QUERY}` });
    return opts;
  }

  function samplePath() {
    return `${publicBase()}api/…`;
  }

  function buildSnippet() {
    const url = samplePath();
    const opts = sendOptions();
    if (!opts.find((o) => o.id === sendAs) && opts[0]) sendAs = opts[0].id;

    if (draft.access === 'upstream') {
      return upstreamSnippet(url);
    }
    return posternSnippet(url);
  }

  function posternSnippet(url) {
    const g = gate();
    if (sendAs === 'header' && g?.header) {
      const name = g.header.name || DEFAULT_GATE_HEADER;
      if (lang === 'curl') return `curl -H "${name}: $POSTERN_TOKEN" \\\n  "${url}"`;
      if (lang === 'js')
        return `await fetch("${url}", {\n  headers: { "${name}": process.env.POSTERN_TOKEN },\n});`;
      return `requests.get(\n  "${url}",\n  headers={"${name}": os.environ["POSTERN_TOKEN"]},\n)`;
    }
    if (sendAs === 'query' && g?.query) {
      const name = g.query.name || DEFAULT_GATE_QUERY;
      const u = url.includes('?') ? `${url}&${name}=$POSTERN_TOKEN` : `${url}?${name}=$POSTERN_TOKEN`;
      if (lang === 'curl') return `curl "${u}"`;
      if (lang === 'js') return `await fetch(\`${url}?${name}=\${process.env.POSTERN_TOKEN}\`);`;
      return `requests.get("${url}", params={"${name}": os.environ["POSTERN_TOKEN"]})`;
    }
    // bearer default
    if (lang === 'curl') return `curl -H "Authorization: Bearer $POSTERN_TOKEN" \\\n  "${url}"`;
    if (lang === 'js')
      return `await fetch("${url}", {\n  headers: { Authorization: \`Bearer \${process.env.POSTERN_TOKEN}\` },\n});`;
    return `requests.get(\n  "${url}",\n  headers={"Authorization": f"Bearer {os.environ['POSTERN_TOKEN']}"},\n)`;
  }

  function upstreamSnippet(url) {
    const a = draft.auth || {};
    if (sendAs === 'up-header' && a.header) {
      const name = a.header.name || 'X-Api-Key';
      if (lang === 'curl') return `curl -H "${name}: $TOKEN_OR_KEY" \\\n  "${url}"`;
      if (lang === 'js') return `await fetch("${url}", { headers: { "${name}": tokenOrKey } });`;
      return `requests.get("${url}", headers={"${name}": token_or_key})`;
    }
    if (sendAs === 'up-query' && a.query) {
      const name = a.query.name || 'apikey';
      if (lang === 'curl') return `curl "${url}?${name}=$TOKEN_OR_KEY"`;
      if (lang === 'js') return `await fetch(\`${url}?${name}=\${tokenOrKey}\`);`;
      return `requests.get("${url}", params={"${name}": token_or_key})`;
    }
    if (sendAs === 'up-basic' && a.authz) {
      const user = a.authz.username || 'user';
      if (lang === 'curl') return `curl -u "${user}:$TOKEN_OR_PASSWORD" \\\n  "${url}"`;
      if (lang === 'js')
        return `await fetch("${url}", {\n  headers: { Authorization: "Basic " + btoa("${user}:" + password) },\n});`;
      return `requests.get("${url}", auth=("${user}", password))`;
    }
    if (lang === 'curl') return `curl -H "Authorization: Bearer $TOKEN_OR_KEY" \\\n  "${url}"`;
    if (lang === 'js')
      return `await fetch("${url}", {\n  headers: { Authorization: \`Bearer \${tokenOrKey}\` },\n});`;
    return `requests.get("${url}", headers={"Authorization": f"Bearer {token_or_key}"})`;
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
        h(
          'div',
          { className: 'flex gap-2 items-center' },
          h('code', { className: 'input flex-1 font-mono text-[13px] truncate py-2' }, base),
          copyBtn(base),
        ),
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
          h('pre', { className: 'code-block m-0' }, snippet),
          h(
            'div',
            { className: 'flex flex-wrap items-center gap-2' },
            h(
              'p',
              { className: 'm-0 text-xs text-muted flex-1' },
              draft.access === 'postern'
                ? 'Replace $POSTERN_TOKEN with the token from the Access tab.'
                : 'Use the Postern token or the real upstream value in that place.',
            ),
            copyBtn(snippet, 'Copy'),
          ),
        ),
      );
    }

    if (draft.access === 'postern' && !isAuthNone(draft.auth)) {
      sections.push(
        h(
          'div',
          { className: 'flex flex-col gap-1.5' },
          h('span', { className: 'font-semibold text-sm text-eggshell' }, `In an app (nzb360, LunaSea…)`),
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
          { className: 'flex flex-col gap-1.5' },
          h('span', { className: 'font-semibold text-sm text-eggshell' }, 'No token needed'),
          h(
            'p',
            { className: 'm-0 text-[13px] text-muted leading-relaxed' },
            'Open paths from Advanced skip the caller token (upstream credential still attached):',
          ),
          h(
            'ul',
            { className: 'm-0 pl-4 flex flex-col gap-1 text-[13px] font-mono text-cream-dim' },
            ...open.map((p) =>
              h('li', {}, `${p.match === 'regex' ? 'regex' : 'prefix'} · ${base.replace(/\/$/, '')}${p.path.startsWith('/') ? p.path : '/' + p.path}`),
            ),
          ),
        ),
      );
    }

    sections.push(
      h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('span', { className: 'font-semibold text-sm text-eggshell' }, 'What callers might get back from Postern'),
        h(
          'div',
          { className: 'flex flex-col gap-1.5 text-[13px]' },
          statusLine('401', 'Token missing or wrong.'),
          statusLine('502', `Postern couldn’t reach ${serviceLabel()} at its upstream URL.`),
          statusLine('Off', 'Service switched off — request refused.'),
        ),
      ),
    );

    wrap.replaceChildren(...sections);
  }

  function statusLine(code, text) {
    return h(
      'div',
      { className: 'flex gap-3' },
      h('span', { className: 'font-mono text-cream-dim w-8 shrink-0' }, code),
      h('span', { className: 'text-muted' }, text),
    );
  }

  function copyBtn(text, label = 'Copy') {
    return h(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm shrink-0',
        onClick: async () => {
          try {
            await copyText(typeof text === 'function' ? text() : text);
            showToast('Copied');
          } catch {
            showToast('Copy failed', 'error');
          }
        },
      },
      label,
    );
  }

  paint();
  wrap._refresh = paint;
  return wrap;
}
