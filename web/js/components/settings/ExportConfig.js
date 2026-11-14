import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { copyText } from '../../lib/clipboard.js';
import { downloadText, exportFilename } from '../../lib/configFile.js';
import { showToast } from '../common/Toast.js';

/**
 * The Export config screen: a redacted file that is safe to share, or a full backup with every
 * secret in it. A full backup is only requested after the person ticks the box, because asking for
 * it is what writes the entry in the admin log.
 *
 * Returns { body, footer, stop }. The drawer puts body and footer in place and calls stop when the
 * screen goes away, which also forgets the secrets it was holding.
 */
export function ExportConfig({ onChanged } = {}) {
  let mode = 'redacted';
  let confirmed = false;
  let loading = false;
  let error = '';
  let stopped = false;
  let generation = 0;
  /** mode -> { text, services, secrets }. The full entry is dropped when the box is unticked. */
  const cache = { redacted: null, full: null };

  const body = h('div', { className: 'bk-view' });
  const footer = h('div', { className: 'bk-footer' });

  const confirmBox = h('input', {
    type: 'checkbox',
    id: 'bk-confirm',
    className: 'checkbox checkbox-sm border-line-strong bg-sunken checked:bg-primary checked:text-primary-content checked:border-primary',
    onChange: (e) => {
      confirmed = e.target.checked;
      if (!confirmed) cache.full = null;
      generation += 1;
      error = '';
      loading = false;
      load();
    },
  });

  const copyBtn = Button({ className: 'btn-outline', onClick: () => copy() }, Icon('copy', { size: 15 }), 'Copy');
  const downloadBtn = Button({ variant: 'primary', onClick: () => download() });

  function current() {
    return cache[mode];
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    error = '';
    generation += 1;
    loading = false;
    load();
  }

  async function load() {
    if (stopped) return;
    if (mode === 'full' && !confirmed) {
      paint();
      return;
    }
    if (cache[mode]) {
      paint();
      return;
    }
    const gen = ++generation;
    const asking = mode;
    loading = true;
    error = '';
    paint();
    try {
      const res = await api.exportConfig(asking, asking === 'full');
      if (stopped || gen !== generation) return;
      cache[asking] = {
        text: JSON.stringify(res.file, null, 2),
        services: res.services,
        secrets: res.secrets,
      };
      if (asking === 'full') onChanged?.();
    } catch (err) {
      if (stopped || gen !== generation) return;
      error = err.message || 'Could not build the export';
    } finally {
      if (gen === generation) loading = false;
      paint();
    }
  }

  async function copy() {
    const data = current();
    if (!data) return;
    try {
      await copyText(data.text);
      showToast(mode === 'full' ? 'Backup copied. It holds every secret.' : 'Config copied');
    } catch {
      showToast('Copy failed', 'error');
    }
  }

  function download() {
    const data = current();
    if (!data) return;
    downloadText(exportFilename(mode), data.text);
    showToast(mode === 'full' ? 'Backup downloaded. Keep it somewhere safe.' : 'Config downloaded');
  }

  function segButton(id, icon, label) {
    const on = mode === id;
    return h(
      'button',
      {
        type: 'button',
        className: `bk-seg-btn${on ? ' is-on' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        onClick: () => setMode(id),
      },
      Icon(icon, { size: 15 }),
      label,
    );
  }

  function facts(data) {
    const secrets = mode === 'full' ? `${data?.secrets ?? 0} included` : 'None';
    return h(
      'dl',
      { className: 'bk-facts' },
      fact('Services', data ? String(data.services) : '…'),
      fact('Secrets', data ? secrets : '…', mode === 'full' && data ? 'is-warn' : data ? 'is-ok' : ''),
      fact('File', exportFilename(mode), 'is-mono'),
    );
  }

  function fact(label, value, tone = '') {
    return h('div', { className: 'bk-fact' }, h('dt', {}, label), h('dd', { className: tone }, value));
  }

  function preview(data) {
    if (mode === 'full' && !confirmed) {
      return h('div', { className: 'bk-code bk-code-empty' }, 'Tick the box above to build the backup.');
    }
    if (error) return h('div', { className: 'bk-code bk-code-empty is-error', role: 'alert' }, error);
    if (!data) return h('div', { className: 'bk-code bk-code-empty' }, loading ? 'Building the file…' : '');
    return h('pre', { className: 'bk-code', tabindex: '0', 'aria-label': 'File contents' }, data.text);
  }

  function paint() {
    if (stopped) return;
    const data = current();
    const hadFocus = document.activeElement === confirmBox;
    confirmBox.checked = confirmed;

    const children = [
      h('div', { className: 'bk-seg', role: 'group', 'aria-label': 'Export type' }, segButton('redacted', 'shield', 'Redacted'), segButton('full', 'key', 'Full backup')),
    ];
    if (mode === 'redacted') {
      children.push(h('p', { className: 'bk-lead' }, 'Upstream keys and caller tokens are removed. Safe to commit to git or share.'));
    } else {
      children.push(
        h(
          'div',
          { className: 'bk-warn', role: 'note' },
          Icon('warn', { size: 16, className: 'bk-warn-icon' }),
          h(
            'p',
            {},
            h('strong', {}, 'This file contains every secret in plain text.'),
            ' Upstream keys and caller tokens. Keep it somewhere safe, and don’t commit it.',
          ),
        ),
        h('label', { className: 'bk-check', htmlFor: 'bk-confirm' }, confirmBox, 'I understand this file contains secrets'),
      );
    }
    if (mode === 'redacted' || confirmed) children.push(facts(data));
    children.push(preview(data));
    if (mode === 'full') {
      children.push(h('p', { className: 'bk-hint' }, 'Full backups need your admin session and are written to the admin log.'));
    } else {
      children.push(h('p', { className: 'bk-hint' }, 'To restore one, add the upstream keys back to the file. Caller tokens are made again on import.'));
    }
    body.replaceChildren(...children);
    if (hadFocus) confirmBox.focus();

    const ready = !!data && !loading;
    copyBtn.disabled = !ready;
    downloadBtn.disabled = !ready;
    downloadBtn.replaceChildren(Icon('download', { size: 15 }), mode === 'full' ? 'Download backup' : 'Download');
    footer.replaceChildren(h('span', { className: 'bk-footer-spacer' }), copyBtn, downloadBtn);
  }

  paint();
  load();

  return {
    body,
    footer,
    stop() {
      stopped = true;
      cache.redacted = null;
      cache.full = null;
    },
  };
}
