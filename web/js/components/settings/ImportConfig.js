import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { setState } from '../../state.js';
import { showToast } from '../common/Toast.js';
import {
  countChips,
  errorSummary,
  fileSummary,
  formatBytes,
  importButtonLabel,
  importable,
  resultErrors,
  resultLabel,
  sortResults,
} from '../../lib/configFile.js';

const MAX_BYTES = 1024 * 1024;
const MARK_ICON = { create: 'plus', overwrite: 'rotate', skip: 'minus', error: 'alert' };
/** The first check never flashes past: the "Checking" screen stays at least this long. */
const MIN_WAIT_MS = 450;

const STEPS = [
  ['Dry run', ' — every service is checked with the same rules as Add service. Nothing changes yet.'],
  ['Review', ' — see what will be created, skipped or overwritten, and any field errors.'],
  ['Import', ' — applied all at once, or not at all. Logged to the admin log.'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The Import config screen, in three steps: pick a file or paste JSON, a dry run, then a review
 * where the person confirms. Nothing changes until they press Import, and one bad service stops
 * the whole import.
 *
 * Returns { body, footer, stop }. onClose goes back to the settings list. onImported runs after a
 * successful import so the drawer can refresh the admin log.
 */
export function ImportConfig({ onClose, onImported }) {
  /** 'input' (pick or paste), 'checking' (first dry run), 'review' (rows and the Import button). */
  let stage = 'input';
  let source = 'upload';
  /** The file chosen in Upload mode: { name, size, text }. */
  let picked = null;
  let pasteText = '';
  let inputError = '';
  /** What was sent: { name, parsed, redacted, exported, services }. */
  let file = null;
  let overwrite = false;
  let result = null;
  /** A problem with the file found while reviewing, such as a newer format. */
  let checkError = '';
  let rechecking = false;
  let importing = false;
  let stopped = false;
  let generation = 0;
  let checkBtn = null;

  const body = h('div', { className: 'bk-view' });
  const footer = h('div', { className: 'bk-footer bk-footer-stack' });

  const picker = h('input', {
    type: 'file',
    id: 'bk-file',
    accept: '.json,application/json',
    className: 'bk-file-input',
    tabindex: '-1',
    'aria-label': 'Config file',
    onChange: (e) => {
      const chosen = e.target.files?.[0];
      e.target.value = '';
      if (chosen) choose(chosen);
    },
  });

  const pasteBox = h('textarea', {
    className: 'input font-mono bk-paste',
    placeholder: '{\n  "version": 1,\n  "services": [ … ]\n}',
    'aria-label': 'Config JSON',
    spellcheck: 'false',
    onInput: (e) => {
      pasteText = e.target.value;
      if (inputError) {
        inputError = '';
        body.querySelector('.bk-problem')?.remove();
      }
      syncCheck();
    },
  });

  const overwriteBox = h('input', {
    type: 'checkbox',
    id: 'bk-overwrite',
    className: 'checkbox checkbox-sm border-line-strong bg-sunken checked:bg-primary checked:text-primary-content checked:border-primary',
    onChange: (e) => {
      overwrite = e.target.checked;
      recheck();
    },
  });

  // ---- step 1: pick or paste ----

  async function choose(chosen) {
    inputError = '';
    picked = null;
    if (chosen.size > MAX_BYTES) {
      inputError = `That file is too large to be a Postern config (the limit is ${formatBytes(MAX_BYTES)}).`;
      paint();
      return;
    }
    let text;
    try {
      text = await chosen.text();
    } catch {
      inputError = 'Could not read that file.';
      paint();
      return;
    }
    if (stopped) return;
    picked = { name: chosen.name, size: chosen.size, text };
    paint();
  }

  function setSource(next) {
    if (next === source) return;
    source = next;
    inputError = '';
    paint();
  }

  function haveInput() {
    return source === 'upload' ? !!picked : pasteText.trim() !== '';
  }

  function syncCheck() {
    if (checkBtn) checkBtn.disabled = !haveInput();
  }

  /** Parses what was given and runs the first dry run behind a "Checking" screen. */
  async function startCheck() {
    if (!haveInput() || stage !== 'input') return;
    const text = source === 'upload' ? picked.text : pasteText;
    if (new Blob([text]).size > MAX_BYTES) {
      inputError = `That is too large to be a Postern config (the limit is ${formatBytes(MAX_BYTES)}).`;
      paint();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      inputError = `That is not valid JSON. ${String(err.message || '').split('\n')[0]}`.trim();
      paint();
      return;
    }
    const services = Array.isArray(parsed?.services) ? parsed.services.length : 0;
    file = {
      name: source === 'upload' ? picked.name : 'Pasted JSON',
      parsed,
      redacted: parsed?.redacted === true,
      exported: typeof parsed?.exported === 'string' ? parsed.exported : '',
      services,
    };
    result = null;
    checkError = '';
    stage = 'checking';
    const gen = ++generation;
    paint();
    const started = Date.now();
    try {
      const res = await api.importConfig(file.parsed, { overwrite, dryRun: true });
      const wait = MIN_WAIT_MS - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      if (stopped || gen !== generation) return;
      result = res;
      file.redacted = res.redacted === true;
      file.services = res.services;
      stage = 'review';
    } catch (err) {
      if (stopped || gen !== generation) return;
      // Back to the first step with the reason, so the file can be fixed or swapped.
      inputError = err.message || 'Could not check the file';
      stage = 'input';
    }
    paint();
  }

  // ---- step 3: review and import ----

  /** A new dry run after the overwrite box changes. The rows stay on screen meanwhile. */
  async function recheck() {
    if (!file || stopped) return;
    const gen = ++generation;
    rechecking = true;
    checkError = '';
    paint();
    try {
      const res = await api.importConfig(file.parsed, { overwrite, dryRun: true });
      if (stopped || gen !== generation) return;
      result = res;
    } catch (err) {
      if (stopped || gen !== generation) return;
      result = null;
      checkError = err.message || 'Could not check the file';
    } finally {
      if (gen === generation) rechecking = false;
      paint();
    }
  }

  async function runImport() {
    if (!file || !result || importing || result.counts.error > 0 || !importable(result.counts)) return;
    importing = true;
    paint();
    try {
      const res = await api.importConfig(file.parsed, { overwrite, dryRun: false });
      if (stopped) return;
      const n = importable(res.counts);
      showToast(`Imported ${n} ${n === 1 ? 'service' : 'services'}`);
      try {
        setState({ services: await api.listServices() });
      } catch {
        /* the list refreshes itself every few seconds */
      }
      onImported?.();
      onClose();
    } catch (err) {
      if (stopped) return;
      importing = false;
      showToast(err.message || 'Could not import', 'error');
      // The file or the services may have changed since the check: look again.
      recheck();
    }
  }

  function backToInput() {
    generation += 1;
    stage = 'input';
    result = null;
    checkError = '';
    inputError = '';
    paint();
  }

  // ---- pieces ----

  function segButton(id, icon, label) {
    const on = source === id;
    return h(
      'button',
      {
        type: 'button',
        className: `bk-seg-btn${on ? ' is-on' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        onClick: () => setSource(id),
      },
      Icon(icon, { size: 15 }),
      label,
    );
  }

  function dropZone() {
    const zone = h(
      'label',
      { className: `bk-drop${picked ? ' has-file' : ''}`, htmlFor: 'bk-file' },
      h('span', { className: 'bk-drop-icon' }, Icon('file', { size: 20 })),
      picked
        ? h(
            'span',
            { className: 'bk-drop-text' },
            h('span', { className: 'bk-drop-title is-mono' }, picked.name),
            h('span', { className: 'bk-drop-hint' }, `${formatBytes(picked.size)} · `, h('span', { className: 'bk-link' }, 'choose a different file')),
          )
        : h(
            'span',
            { className: 'bk-drop-text' },
            h('span', { className: 'bk-drop-title' }, 'Drop a Postern export here'),
            h('span', { className: 'bk-drop-hint' }, 'or ', h('span', { className: 'bk-link' }, 'choose a file'), ` · .json, up to ${formatBytes(MAX_BYTES)}`),
          ),
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) choose(dropped);
    });
    return zone;
  }

  function steps() {
    return h(
      'div',
      { className: 'bk-steps' },
      h('h3', { className: 'bk-steps-title' }, 'What happens next'),
      h(
        'ol',
        {},
        ...STEPS.map(([lead, rest], i) =>
          h('li', { className: 'bk-step' }, h('span', { className: 'bk-step-n' }, String(i + 1)), h('span', {}, h('strong', {}, lead), rest)),
        ),
      ),
    );
  }

  function problem(message) {
    return h('p', { className: 'bk-problem', role: 'alert' }, Icon('alert', { size: 14 }), message);
  }

  function fileCard() {
    return h(
      'div',
      { className: 'bk-filecard' },
      h('span', { className: 'bk-filecard-icon' }, Icon('file', { size: 18 })),
      h(
        'div',
        { className: 'bk-filecard-main' },
        h('div', { className: 'bk-filecard-name' }, file.name),
        h('div', { className: 'bk-filecard-sub' }, fileSummary(file)),
      ),
      Button({ variant: 'ghost', size: 'sm', onClick: backToInput }, 'Change'),
    );
  }

  function statusLine() {
    if (rechecking) return h('p', { className: 'bk-status', role: 'status' }, 'Checking the file…');
    if (!result) return null;
    return h(
      'p',
      { className: 'bk-status is-ok', role: 'status' },
      Icon('check', { size: 14 }),
      'Checked with a dry run · nothing changed yet',
    );
  }

  function chips() {
    const list = countChips(result?.counts);
    if (!list.length) return null;
    return h('div', { className: 'bk-chips' }, ...list.map((c) => h('span', { className: `bk-chip is-${c.kind}` }, c.text)));
  }

  function row(r) {
    const errs = resultErrors(r);
    return h(
      'li',
      { className: `bk-row is-${r.action}` },
      h('span', { className: `bk-row-mark is-${r.action}` }, Icon(MARK_ICON[r.action] || 'dot', { size: 14 })),
      h(
        'div',
        { className: 'bk-row-main' },
        h('div', { className: 'bk-row-name' }, r.name),
        r.url ? h('div', { className: 'bk-row-url' }, r.url) : null,
      ),
      h('span', { className: `bk-row-act is-${r.action}` }, resultLabel(r)),
      errs.length
        ? h(
            'ul',
            { className: 'bk-row-errs' },
            ...errs.map((e) => h('li', {}, h('code', {}, e.key), ' ', e.message)),
          )
        : null,
    );
  }

  function overwriteRow() {
    return h(
      'label',
      { className: 'bk-overwrite', htmlFor: 'bk-overwrite' },
      overwriteBox,
      h(
        'span',
        { className: 'bk-overwrite-copy' },
        h('span', { className: 'bk-overwrite-title' }, 'Overwrite services with the same name'),
        h(
          'span',
          { className: 'bk-overwrite-sub' },
          overwrite
            ? 'On: a service in the file replaces the one with that name. Keys and tokens the file leaves out are kept.'
            : 'Off: existing services are skipped',
        ),
      ),
    );
  }

  // ---- painting ----

  function paintInput() {
    const children = [
      picker,
      h('div', { className: 'bk-seg', role: 'group', 'aria-label': 'How to add the file' }, segButton('upload', 'upload', 'Upload file'), segButton('paste', 'copy', 'Paste JSON')),
      source === 'upload' ? dropZone() : pasteBox,
    ];
    if (inputError) children.push(problem(inputError));
    children.push(
      steps(),
      h(
        'p',
        { className: 'bk-note' },
        'Works with both redacted exports and full backups. Redacted files have no secrets, so services that need one will fail the check.',
      ),
    );
    body.replaceChildren(...children);
    if (source === 'paste' && pasteBox.value !== pasteText) pasteBox.value = pasteText;

    checkBtn = Button({ variant: 'primary', disabled: !haveInput(), onClick: startCheck }, 'Check file');
    footer.replaceChildren(
      h('div', { className: 'bk-footer-row' }, h('span', { className: 'bk-footer-spacer' }), Button({ variant: 'ghost', onClick: () => onClose() }, 'Cancel'), checkBtn),
    );
  }

  function paintChecking() {
    const n = file?.services;
    body.replaceChildren(
      h(
        'div',
        { className: 'bk-wait', role: 'status' },
        h('span', { className: 'bk-spinner', 'aria-hidden': 'true' }),
        h('p', { className: 'bk-wait-title' }, `Checking ${file?.name || 'the file'}…`),
        h('p', { className: 'bk-wait-sub' }, n ? `Dry run · validating ${n} ${n === 1 ? 'service' : 'services'}` : 'Dry run'),
      ),
    );
    footer.replaceChildren();
    checkBtn = null;
  }

  function paintReview() {
    const hadFocus = document.activeElement === overwriteBox;
    overwriteBox.checked = overwrite;
    const children = [fileCard()];
    const status = statusLine();
    if (status) children.push(status);
    if (checkError) children.push(problem(checkError));
    if (result) {
      const c = chips();
      if (c) children.push(c);
      children.push(h('ul', { className: 'bk-rows' }, ...sortResults(result.results).map(row)));
      children.push(overwriteRow());
    }
    body.replaceChildren(...children);
    if (hadFocus) overwriteBox.focus();

    const counts = result?.counts;
    const hasErrors = !!counts && counts.error > 0;
    const nothing = !!result && !hasErrors && importable(counts) === 0;
    const canImport = !!result && !hasErrors && !nothing && !rechecking && !importing;

    const lines = [];
    if (hasErrors) lines.push(problem(errorSummary(counts)));
    else if (nothing) lines.push(h('p', { className: 'bk-hint' }, 'Nothing to import. Every service in the file already exists. Turn on overwrite to replace them.'));
    const label = importing ? 'Importing…' : result ? importButtonLabel(counts) : 'Import';
    footer.replaceChildren(
      ...lines,
      h(
        'div',
        { className: 'bk-footer-row' },
        h('span', { className: 'bk-footer-spacer' }),
        Button({ variant: 'ghost', onClick: () => onClose() }, 'Cancel'),
        Button({ variant: 'primary', disabled: !canImport, onClick: runImport }, label),
      ),
    );
    checkBtn = null;
  }

  function paint() {
    if (stopped) return;
    if (stage === 'input') paintInput();
    else if (stage === 'checking') paintChecking();
    else paintReview();
  }

  paint();

  return {
    body,
    footer,
    stop() {
      stopped = true;
      picked = null;
      file = null;
      result = null;
    },
  };
}
