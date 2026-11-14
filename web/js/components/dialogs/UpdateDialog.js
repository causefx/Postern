import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { toast } from '../common/Toast.js';
import { api } from '../../api.js';
import { setState } from '../../state.js';
import { releaseNoteNodes } from '../../lib/releaseNotes.js';

function dateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function behind(n) {
  return n === 1 ? '1 release behind' : `${n} releases behind`;
}

/** How to apply the update. Postern never updates itself; this just says what to run. */
function howTo(st) {
  const latest = st.latest;
  if (st.container) {
    return h(
      'div',
      { className: 'upd-how' },
      h('p', { className: 'm-0 text-sm text-soft' }, 'Pull the new image and recreate the container. Your data volume is kept.'),
      h('pre', { className: 'upd-cmd' }, 'docker compose pull && docker compose up -d'),
      h(
        'p',
        { className: 'm-0 text-xs text-muted' },
        'Or with plain Docker: ',
        h('code', { className: 'rn-code' }, `docker pull ${st.image}:${latest}`),
        '. Pinned to an older tag? Change the tag first.',
      ),
    );
  }
  return h(
    'div',
    { className: 'upd-how' },
    h(
      'p',
      { className: 'm-0 text-sm text-soft' },
      'Download the new binary from the release page, replace the old one, and restart. Your data files are kept.',
    ),
  );
}

function releaseBlock(rel) {
  const date = dateLabel(rel.date);
  const notes = releaseNoteNodes(rel.body);
  return h(
    'section',
    { className: 'upd-release' },
    h(
      'div',
      { className: 'upd-release-head' },
      h('span', { className: 'upd-release-ver' }, `v${rel.version}`),
      date ? h('span', { className: 'upd-release-date' }, date) : null,
      h(
        'a',
        { className: 'upd-release-link', href: rel.url, target: '_blank', rel: 'noopener noreferrer', title: 'Open on GitHub' },
        Icon('arrow', { size: 13 }),
      ),
    ),
    notes.length ? h('div', { className: 'upd-notes' }, ...notes) : h('p', { className: 'rn-text text-muted' }, 'No notes for this release.'),
  );
}

function summaryNodes(st) {
  if (!st) return [h('p', { className: 'm-0 text-sm text-muted' }, 'Loading…')];
  if (!st.enabled) {
    return [
      h(
        'p',
        { className: 'm-0 text-sm text-soft' },
        st.reason === 'dev'
          ? `This is a development build (${st.current}), so update checks are skipped.`
          : 'Update checks are turned off. Remove POSTERN_UPDATE_CHECK=off and restart to turn them on.',
      ),
    ];
  }
  const out = [];
  if (st.available) {
    out.push(
      h(
        'p',
        { className: 'm-0 text-sm' },
        'You are on ',
        h('strong', {}, `v${st.current}`),
        '. The latest is ',
        h('strong', {}, `v${st.latest}`),
        st.releases.length ? ` (${behind(st.releases.length)}${st.more ? ' or more' : ''}).` : '.',
      ),
    );
  } else if (st.latest) {
    out.push(
      h('p', { className: 'm-0 text-sm' }, 'You are on the latest version, ', h('strong', {}, `v${st.current}`), '.'),
    );
  } else {
    out.push(h('p', { className: 'm-0 text-sm text-muted' }, `You are on v${st.current}. No check has finished yet.`));
  }
  if (st.error) {
    out.push(h('p', { className: 'm-0 text-xs text-danger' }, `Last check failed: ${st.error}`));
  } else if (st.checkedAt) {
    out.push(h('p', { className: 'm-0 text-xs text-muted' }, `Checked ${new Date(st.checkedAt).toLocaleString()}`));
  }
  return out;
}

export function openUpdateDialog({ trigger } = {}) {
  let st = null;
  const summary = h('div', { className: 'flex flex-col gap-1' });
  const content = h('div', { className: 'upd-body' });
  const checkBtn = Button({ variant: 'ghost', onClick: () => check() }, 'Check now');

  function paint() {
    summary.replaceChildren(...summaryNodes(st));
    content.replaceChildren();
    if (st?.enabled && st.available) {
      content.append(howTo(st));
      content.append(
        h(
          'div',
          { className: 'upd-releases', tabindex: '0', 'aria-label': 'What changed' },
          ...st.releases.map(releaseBlock),
          st.more
            ? h(
                'p',
                { className: 'rn-text text-muted' },
                'There are older releases not listed here. ',
                h('a', { className: 'rn-link', href: st.releasesUrl, target: '_blank', rel: 'noopener noreferrer' }, 'See all releases on GitHub'),
                '.',
              )
            : null,
        ),
      );
    }
    checkBtn.disabled = !st?.enabled;
  }

  async function check() {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    try {
      st = await api.checkUpdate();
      setState({ update: st });
      paint();
      if (st.error) toast.error("Couldn't check for updates", { detail: st.error });
      else if (!st.available) toast.success('You are up to date');
    } catch (err) {
      toast.error("Couldn't check for updates", { detail: err.message });
    } finally {
      checkBtn.textContent = 'Check now';
      checkBtn.disabled = !st?.enabled;
    }
  }

  const closeBtn = Button({ variant: 'primary', onClick: () => closeModal(dlg) }, 'Close');
  const footer = h(
    'div',
    { className: 'flex w-full items-center gap-2' },
    h(
      'a',
      { className: 'upd-all-link', href: 'https://github.com/causefx/Postern/releases', target: '_blank', rel: 'noopener noreferrer' },
      'All releases',
    ),
    h('span', { className: 'flex-1' }),
    checkBtn,
    closeBtn,
  );

  const dlg = Modal({ title: 'Updates', body: h('div', { className: 'flex flex-col gap-3' }, summary, content), footer, wide: true });
  paint();
  openModal(dlg, trigger);
  closeBtn.focus();

  // Show what the server already knows, then refresh the view. This never calls GitHub.
  api
    .update()
    .then((next) => {
      st = next;
      setState({ update: next });
      paint();
    })
    .catch(() => {
      summary.replaceChildren(h('p', { className: 'm-0 text-sm text-danger' }, 'Could not load update status.'));
    });
  return dlg;
}
