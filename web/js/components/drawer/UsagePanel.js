import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { slugify } from '../../lib/slug.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { usageSnippet, usageSendOptions } from '../../lib/usageSnippet.js';
import { copyText } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { state } from '../../state.js';
import { api } from '../../api.js';
import { blankServiceRecent } from '../../lib/liveList.js';
import { requestWhen } from '../../lib/serviceDisplay.js';

/**
 * Usage tab: examples derived only from the current draft config.
 */
export function UsagePanel({ draft, savedName }) {
  const wrap = h('div', { className: 'flex flex-col gap-5' });
  let lang = 'curl';
  let sendAs = 'bearer';
  let events = [];
  let eventsLoaded = false;
  let live = false;
  let liveTimer = 0;
  let logSig = '';
  let generation = 0;

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
          statusLine('403', 'Service switched off, or this caller token is paused.'),
        ),
      ),
    );

    sections.push(recentRequests());

    wrap.replaceChildren(...sections);
  }

  function eventSig(ev) {
    return `${ev.time}|${ev.status}|${ev.who}|${ev.reason || ''}|${ev.method}|${ev.path}`;
  }

  function callerBits(ev) {
    const paused = ev.reason === 'paused' || ev.who === 'paused';
    const name = ev.who && ev.who !== 'paused' ? ev.who : '';
    const bits = [];
    if (name) bits.push(h('span', { className: 'text-muted max-w-24 shrink-0 truncate', title: name }, name));
    if (paused) bits.push(h('span', { className: 'text-warn shrink-0 text-xs' }, 'paused'));
    if (!bits.length) bits.push(h('span', { className: 'text-muted w-16 shrink-0 truncate' }, ev.who || ''));
    return bits;
  }

  function logNodes() {
    if (!events.length) return [h('p', { className: 'm-0 text-xs text-muted' }, 'No requests yet.')];
    return events
      .slice()
      .reverse()
      .map((ev) =>
        h(
          'div',
          { className: 'flex gap-3 text-[13px] font-mono' },
          h('span', { className: 'text-cream-dim w-10 shrink-0' }, String(ev.status || '')),
          ...callerBits(ev),
          h('span', { className: 'text-eggshell truncate' }, `${ev.method || ''} ${ev.path || ''}`),
          h(
            'span',
            { className: 'text-muted ml-auto shrink-0 whitespace-nowrap text-xs', title: ev.time || '' },
            requestWhen(ev.time),
          ),
        ),
      );
  }

  function renderLog() {
    wrap.querySelector('[data-activity-log]')?.replaceChildren(...logNodes());
  }

  function stopLive() {
    if (liveTimer) window.clearInterval(liveTimer);
    liveTimer = 0;
  }

  async function pullActivity() {
    if (!wrap.isConnected) {
      stopLive();
      return;
    }
    const gen = generation;
    try {
      const list = await api.activity(savedName);
      if (gen !== generation) return;
      const next = Array.isArray(list) ? list : [];
      const nextSig = next.map(eventSig).join('\n');
      if (nextSig === logSig) return;
      logSig = nextSig;
      events = next;
      renderLog();
    } catch {
      /* keep the lines already shown */
    }
  }

  function paintLive(button) {
    button.setAttribute('aria-pressed', live ? 'true' : 'false');
    button.setAttribute('aria-label', live ? 'Live updates on' : 'Live updates off');
    const word = button.querySelector('[data-live-state]');
    if (word) word.textContent = live ? 'On' : 'Off';
  }

  async function clearRecent(button) {
    if (!savedName || button.disabled) return;
    button.disabled = true;
    generation += 1;
    try {
      await api.clearActivity(savedName);
      generation += 1;
      events = [];
      logSig = '';
      renderLog();
      blankServiceRecent(savedName);
    } catch (err) {
      showToast(err.message || 'Could not clear recent requests', 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function toggleLive(button) {
    live = !live;
    paintLive(button);
    stopLive();
    if (!live) return;
    pullActivity();
    liveTimer = window.setInterval(pullActivity, 2000);
  }

  function recentRequests() {
    if (!savedName) {
      return h('p', { className: 'm-0 text-xs text-muted' }, 'Save the service to see recent requests.');
    }
    return h(
      'div',
      { className: 'flex flex-col gap-2' },
      h(
        'div',
        { className: 'flex items-center justify-between gap-2' },
        h('span', { className: 'font-semibold text-sm text-eggshell' }, 'Recent requests'),
        h(
          'div',
          { className: 'flex items-center gap-2' },
          Button(
            {
              size: 'sm',
              'aria-label': 'Clear recent requests',
              onClick: (e) => clearRecent(e.currentTarget),
            },
            'Clear',
          ),
          Button(
            {
              size: 'sm',
              className: 'live-toggle gap-1.5',
              'aria-pressed': live ? 'true' : 'false',
              'aria-label': live ? 'Live updates on' : 'Live updates off',
              onClick: (e) => toggleLive(e.currentTarget),
            },
            h('span', { className: 'status-dot', 'aria-hidden': 'true' }),
            'Live',
            h('span', { 'data-live-state': '1' }, live ? 'On' : 'Off'),
          ),
        ),
      ),
      h('div', { className: 'flex flex-col gap-1.5', 'data-activity-log': '1' }, ...logNodes()),
    );
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
    return Button(
      {
        size: 'sm',
        className: 'shrink-0',
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
  if (savedName && !eventsLoaded) {
    eventsLoaded = true;
    api.activity(savedName).then((list) => {
      events = Array.isArray(list) ? list : [];
      logSig = events.map(eventSig).join('\n');
      paint();
    }).catch(() => {});
  }
  wrap._refresh = paint;
  return wrap;
}
