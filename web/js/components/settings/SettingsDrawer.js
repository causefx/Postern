import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { setState, state } from '../../state.js';
import { openUpdateDialog } from '../dialogs/UpdateDialog.js';
import { showToast } from '../common/Toast.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { SettingsRow, setSummary } from './SettingsRow.js';
import { SettingControls } from './SettingControls.js';
import { SettingsTabs } from './SettingsTabs.js';
import { AuditPanel } from './AuditPanel.js';
import { RequestsPanel } from './RequestsPanel.js';
import { PasswordLoginSetting } from './PasswordLoginSetting.js';
import { EmbedSetting } from './EmbedSetting.js';
import { ExportConfig } from './ExportConfig.js';
import { ImportConfig } from './ImportConfig.js';
import {
  ACTIVITY_PRESETS,
  AUDIT_PRESETS,
  DEFAULT_ACTIVITY_LIMIT,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_RATE_LIMIT,
  MAX_ACTIVITY_LIMIT,
  MAX_AUDIT_LIMIT,
  MAX_RATE_LIMIT,
  RATE_PRESETS,
  SETTING_DEFS,
  SETTING_GROUPS,
  activitySummary,
  clampActivity,
  clampAudit,
  clampRate,
  embedSummary,
  parseEmbedOrigins,
  perSecondLabel,
  passwordSummary,
  rateSummary,
  sameList,
  settingVisible,
  storageSummary,
  versionSummary,
} from '../../lib/settings.js';

let root = null;
let ctrl = null;
let generation = 0;

export function isSettingsOpen() {
  return !!root;
}

export function closeSettings({ skipConfirm = false } = {}) {
  if (!root) return true;
  if (!skipConfirm && ctrl?.isDirty?.()) {
    if (!confirm('Discard unsaved changes?')) return false;
  }
  ctrl?.stop?.();
  generation += 1;
  root.classList.remove('drawer-open');
  const el = root;
  root = null;
  ctrl = null;
  setState({ settingsOpen: false });
  setTimeout(() => el.remove(), 180);
  return true;
}

/** Escape and the back gesture: leave Export or Import first, then close the drawer. */
export function backOrCloseSettings() {
  if (ctrl?.inSubview?.()) {
    ctrl.back();
    return true;
  }
  return closeSettings();
}

/** Switch the open drawer to 'settings', 'requests' or 'activity'. */
export function showSettingsTab(tab) {
  ctrl?.showTab?.(tab);
}

export function openSettings({ tab = 'settings' } = {}) {
  if (root) return;
  const gen = ++generation;
  ctrl = createController({
    initialTab: tab,
    onReady: (el) => {
      if (gen !== generation) return;
      root = el;
      document.body.append(root);
      requestAnimationFrame(() => {
        if (root !== el) return;
        root.classList.add('drawer-open');
        root.querySelector('.settings-search input')?.focus();
      });
      setState({ settingsOpen: true });
    },
  });
}

export function requestSettingsSave() {
  return ctrl?.save?.();
}

const TABS = ['settings', 'requests', 'activity'];

function createController({ onReady, initialTab = 'settings' }) {
  let saved = null;
  let draft = {
    rateLimit: DEFAULT_RATE_LIMIT,
    activityLimit: DEFAULT_ACTIVITY_LIMIT,
    auditLimit: DEFAULT_AUDIT_LIMIT,
    passwordLogin: true,
    embedOrigins: [],
  };
  /** What is typed in the embedding box, and what is wrong with it. The draft keeps the parsed list. */
  let embedText = '';
  let embedError = '';
  let oidcConfigured = false;
  let oidcSession = false;
  let poll = 0;
  let query = '';
  let group = 'all';
  let tab = TABS.includes(initialTab) ? initialTab : 'settings';
  /** 'list' is the settings list and its tabs. 'export' and 'import' replace the whole drawer body. */
  let view = 'list';
  let sub = null;
  let auditEntries = [];
  let auditService = 'all';
  const open = new Set();
  let saving = false;
  let loaded = false;
  /** Whether the data file is encrypted at rest. Read-only: it is set by an environment variable. */
  let encrypted = false;
  let loadError = '';

  const listHost = h('div', { className: 'settings-list' });
  const discardBtn = Button({ size: 'sm', onClick: () => discard() }, 'Discard');
  const saveBtn = Button(
    { variant: 'primary', size: 'sm', className: 'gap-1.5', onClick: () => save() },
    'Save',
    h('kbd', { className: 'kbd-hint kbd-hint-on-primary' }, `${isMac() ? '⌘' : 'Ctrl'}S`),
  );
  const resetBtn = Button({ size: 'sm', className: 'btn-outline', onClick: () => resetAll() }, 'Reset all');

  function isDirty() {
    if (!saved) return false;
    return (
      draft.rateLimit !== saved.rateLimit ||
      draft.activityLimit !== saved.activityLimit ||
      draft.auditLimit !== saved.auditLimit ||
      draft.passwordLogin !== saved.passwordLogin ||
      !sameList(draft.embedOrigins, saved.embedOrigins)
    );
  }

  function setRate(n) {
    draft.rateLimit = clampRate(n);
    sync();
  }

  function setActivity(n) {
    draft.activityLimit = clampActivity(n);
    sync();
  }

  function setAudit(n) {
    draft.auditLimit = clampAudit(n);
    sync();
  }

  function setEmbedText(text) {
    embedText = text;
    const parsed = parseEmbedOrigins(text);
    embedError = parsed.error;
    if (!parsed.error) draft.embedOrigins = parsed.origins;
    sync();
  }

  function showEmbed() {
    embedText = (draft.embedOrigins || []).join('\n');
    embedError = '';
  }

  function resetAll() {
    draft.rateLimit = DEFAULT_RATE_LIMIT;
    draft.activityLimit = DEFAULT_ACTIVITY_LIMIT;
    draft.auditLimit = DEFAULT_AUDIT_LIMIT;
    draft.passwordLogin = true;
    draft.embedOrigins = [];
    showEmbed();
    sync();
    paintList();
  }

  function discard() {
    if (!saved) return;
    draft = { ...saved, embedOrigins: [...saved.embedOrigins] };
    showEmbed();
    paintList();
  }

  function passwordBlocked() {
    return oidcConfigured && !draft.passwordLogin && !oidcSession;
  }

  function stopPoll() {
    if (poll) window.clearInterval(poll);
    poll = 0;
  }

  function markOIDC() {
    oidcSession = true;
    stopPoll();
    if (loaded) paintList();
  }

  function testOIDC() {
    sessionStorage.setItem('postern-password-off', '1');
    const pop = window.open('/admin/oidc/start?remember=1&popup=1', 'postern-oidc', 'popup,width=480,height=720');
    if (!pop) {
      location.assign('/admin/oidc/start?remember=1&return=settings');
      return;
    }
    stopPoll();
    poll = window.setInterval(async () => {
      try {
        const data = await api.settings();
        if (data.oidcSession) markOIDC();
      } catch {
        /* keep waiting for the test window */
      }
    }, 1000);
  }

  async function save() {
    if (view !== 'list') return;
    if (!loaded || !isDirty() || saving || passwordBlocked() || embedError) return;
    saving = true;
    sync();
    try {
      const payload = {
        rateLimit: draft.rateLimit,
        activityLimit: draft.activityLimit,
        auditLimit: draft.auditLimit,
        embedOrigins: draft.embedOrigins,
      };
      if (oidcConfigured) payload.passwordLogin = draft.passwordLogin;
      const next = await api.saveSettings(payload);
      saved = {
        rateLimit: clampRate(next.rateLimit),
        activityLimit: clampActivity(next.activityLimit),
        auditLimit: clampAudit(next.auditLimit),
        passwordLogin: next.passwordLogin !== false,
        embedOrigins: Array.isArray(next.embedOrigins) ? next.embedOrigins : [],
      };
      oidcConfigured = !!next.oidc;
      oidcSession = !!next.oidcSession;
      draft = { ...saved, embedOrigins: [...saved.embedOrigins] };
      showEmbed();
      showToast('Settings saved');
      const log = await api.audit().catch(() => null);
      if (log) auditEntries = log.entries || [];
    } catch (err) {
      showToast(err.message || 'Could not save settings');
    } finally {
      saving = false;
      sync();
      paintChrome();
    }
  }

  function sync() {
    listHost.querySelectorAll('[data-summary]').forEach((el) => setSummary(el, summaryFor(el.dataset.summary)));
    const rateInput = listHost.querySelector('[data-input="rate"]');
    if (rateInput && document.activeElement !== rateInput) rateInput.value = String(draft.rateLimit);
    const actInput = listHost.querySelector('[data-input="activity"]');
    if (actInput && document.activeElement !== actInput) actInput.value = String(draft.activityLimit);
    const auditInput = listHost.querySelector('[data-input="audit"]');
    if (auditInput && document.activeElement !== auditInput) auditInput.value = String(draft.auditLimit);
    listHost.querySelectorAll('[data-preset]').forEach((btn) => {
      const current = btn.dataset.preset === 'rate' ? draft.rateLimit : btn.dataset.preset === 'audit' ? draft.auditLimit : draft.activityLimit;
      const on = Number(btn.dataset.value) === current;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    listHost.querySelectorAll('.settings-step').forEach((btn) => {
      const input = btn.parentElement?.querySelector('[data-input]');
      if (!input) return;
      const field = input.dataset.input;
      const value = field === 'rate' ? draft.rateLimit : field === 'audit' ? draft.auditLimit : draft.activityLimit;
      const min = field === 'rate' ? 0 : 1;
      const max = field === 'rate' ? MAX_RATE_LIMIT : field === 'audit' ? MAX_AUDIT_LIMIT : MAX_ACTIVITY_LIMIT;
      const decrease = btn.getAttribute('aria-label')?.startsWith('Decrease');
      btn.disabled = decrease ? value <= min : value >= max;
    });
    const note = listHost.querySelector('[data-note="rate"]');
    if (note) note.textContent = perSecondLabel(draft.rateLimit);
    const rateDefault = listHost.querySelector('[data-default="rate"]');
    if (rateDefault) rateDefault.disabled = draft.rateLimit === DEFAULT_RATE_LIMIT;
    const actDefault = listHost.querySelector('[data-default="activity"]');
    if (actDefault) actDefault.disabled = draft.activityLimit === DEFAULT_ACTIVITY_LIMIT;
    const auditDefault = listHost.querySelector('[data-default="audit"]');
    if (auditDefault) auditDefault.disabled = draft.auditLimit === DEFAULT_AUDIT_LIMIT;
    listHost.querySelector('[data-embed]')?._set?.({ error: embedError, origins: draft.embedOrigins });
    // A half-typed list is not a change yet, but it must not look saved either.
    const dirty = isDirty() || !!embedError;
    discardBtn.disabled = !dirty || saving;
    saveBtn.disabled = !dirty || saving || !loaded || passwordBlocked() || !!embedError;
    resetBtn.disabled = saving || !loaded;
  }

  /** What a row shows on its right, from the current draft. */
  function summaryFor(id) {
    switch (id) {
      case 'rate':
        return rateSummary(draft.rateLimit);
      case 'activity':
        return activitySummary(draft.activityLimit);
      case 'audit':
        return activitySummary(draft.auditLimit);
      case 'password':
        return passwordSummary(oidcConfigured ? draft.passwordLogin : true);
      case 'embed':
        return embedSummary(draft.embedOrigins);
      case 'storage':
        return storageSummary(encrypted);
      case 'version':
        return versionSummary(state.update);
      default:
        return null;
    }
  }

  /** The line under a row's name. Most are fixed text from the definition. */
  function hintFor(def) {
    if (def.id === 'storage') {
      return encrypted
        ? 'Upstream keys and tokens are encrypted at rest'
        : h('span', {}, 'Set ', h('code', {}, 'POSTERN_KEY'), ' or ', h('code', {}, 'POSTERN_KEY_FILE'), ' and restart to encrypt keys and tokens');
    }
    if (def.id === 'version') {
      const v = state.update?.current || state.meta?.version || '';
      return v ? `Postern v${v}` : 'Postern';
    }
    return def.hint;
  }

  function bodyFor(id) {
    switch (id) {
      case 'rate':
        return rateBody();
      case 'audit':
        return auditBody();
      case 'password':
        return passwordBody();
      case 'embed':
        return embedBody();
      case 'storage':
        return storageBody();
      case 'version':
        return versionBody();
      default:
        return activityBody();
    }
  }

  function paintList() {
    listHost.replaceChildren();
    if (!loaded) {
      listHost.append(h('p', { className: 'settings-empty' }, loadError || 'Loading settings…'));
      return;
    }
    // Rows that match the search and the chip, gathered into one card per group.
    const groups = [];
    for (const def of SETTING_DEFS) {
      if (group !== 'all' && def.group !== group) continue;
      if (!settingVisible(query, def)) continue;
      let g = groups.find((x) => x.id === def.group);
      if (!g) groups.push((g = { id: def.group, label: def.groupLabel, rows: [] }));
      g.rows.push(def);
    }
    for (const g of groups) {
      listHost.append(h('h3', { className: 'settings-group' }, g.label), h('div', { className: 'settings-gcard' }, ...g.rows.map(rowFor)));
    }
    if (!groups.length) listHost.append(h('p', { className: 'settings-empty' }, 'No matching settings.'));
    sync();
  }

  function rowFor(def) {
    const common = { id: def.id, icon: def.icon, title: def.title, hint: hintFor(def), summary: summaryFor(def.id) };
    if (def.kind === 'action') return SettingsRow({ ...common, onClick: () => showView(def.id) });
    const toggle = () => {
      if (open.has(def.id)) open.delete(def.id);
      else open.add(def.id);
      paintList();
    };
    // The version row opens the update dialog, unless update checks are off and there is only a reason to read.
    if (def.id === 'version' && state.update?.enabled !== false) {
      return SettingsRow({ ...common, onClick: (e) => openUpdateDialog({ trigger: e.currentTarget }) });
    }
    const isOpen = open.has(def.id);
    return SettingsRow(
      { ...common, tone: def.id === 'storage' && !encrypted ? 'warn' : '', open: isOpen, onClick: toggle },
      isOpen ? bodyFor(def.id) : null,
    );
  }

  /** Read-only: whether the file holding upstream keys and tokens is encrypted. */
  function storageBody() {
    return h(
      'div',
      { className: 'settings-controls' },
      h(
        'p',
        { className: 'settings-detail' },
        encrypted
          ? 'The file that holds your upstream keys and caller tokens is stored encrypted (AES-256-GCM). The key comes from POSTERN_KEY or POSTERN_KEY_FILE, which this screen cannot change.'
          : 'The file that holds your upstream keys and caller tokens is stored as plain JSON. Set POSTERN_KEY or POSTERN_KEY_FILE and restart, and Postern encrypts it in place.',
      ),
    );
  }

  /** Only reached when update checks are off: say why, since there is no dialog to open. */
  function versionBody() {
    const u = state.update;
    return h(
      'div',
      { className: 'settings-controls' },
      h(
        'p',
        { className: 'settings-detail' },
        u?.reason === 'dev'
          ? 'This is a development build, so update checks are skipped.'
          : 'Update checks are off. Remove POSTERN_UPDATE_CHECK=off and restart to turn them on.',
      ),
    );
  }

  function rateBody() {
    return SettingControls({
      field: 'rate',
      label: 'Rate limit',
      value: draft.rateLimit,
      min: 0,
      max: MAX_RATE_LIMIT,
      presets: RATE_PRESETS,
      note: perSecondLabel(draft.rateLimit),
      detail: 'Per caller. Requests over the limit get 429 Too Many Requests and never reach the service. 0 turns it off.',
      fieldName: `settings.rateLimit · default ${DEFAULT_RATE_LIMIT}`,
      isDefault: draft.rateLimit === DEFAULT_RATE_LIMIT,
      onChange: setRate,
      onDefault: () => setRate(DEFAULT_RATE_LIMIT),
    });
  }

  function activityBody() {
    return SettingControls({
      field: 'activity',
      label: 'Request log',
      value: draft.activityLimit,
      min: 1,
      max: MAX_ACTIVITY_LIMIT,
      presets: ACTIVITY_PRESETS,
      note: 'Kept separately for each service. Lowering this drops the oldest requests on save.',
      detail: 'Requests that went through the proxy. Shown in the Recent column, in each service’s Requests tab and in the Requests tab here. Query secrets are redacted.',
      fieldName: `settings.activityLimit · default ${DEFAULT_ACTIVITY_LIMIT}`,
      isDefault: draft.activityLimit === DEFAULT_ACTIVITY_LIMIT,
      onChange: setActivity,
      onDefault: () => setActivity(DEFAULT_ACTIVITY_LIMIT),
    });
  }

  function auditBody() {
    return SettingControls({
      field: 'audit',
      label: 'Admin log',
      value: draft.auditLimit,
      min: 1,
      max: MAX_AUDIT_LIMIT,
      presets: AUDIT_PRESETS,
      note: 'One list for all services. Lowering this drops the oldest entries on save.',
      detail: 'Changes made in this admin UI to services, tokens and settings. Shown in the Admin log tab. It does not include secrets.',
      fieldName: `settings.auditLimit · default ${DEFAULT_AUDIT_LIMIT}`,
      isDefault: draft.auditLimit === DEFAULT_AUDIT_LIMIT,
      onChange: setAudit,
      onDefault: () => setAudit(DEFAULT_AUDIT_LIMIT),
    });
  }

  function embedBody() {
    return EmbedSetting({ text: embedText, error: embedError, origins: draft.embedOrigins, onInput: setEmbedText });
  }

  function passwordBody() {
    return PasswordLoginSetting({
      allowed: draft.passwordLogin,
      oidc: oidcConfigured,
      tested: oidcSession,
      onChange: (on) => {
        draft.passwordLogin = on;
        paintList();
      },
      onTest: testOIDC,
    });
  }

  function setGroup(next) {
    group = next;
    for (const chip of chipRow.querySelectorAll('[data-group]')) {
      const on = chip.dataset.group === group;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    paintList();
  }

  function showAuditSetting() {
    tab = 'settings';
    open.add('audit');
    setGroup('activity');
    paintChrome();
    queueMicrotask(() => document.getElementById('audit-panel')?.scrollIntoView({ block: 'nearest' }));
  }

  function showActivitySetting() {
    tab = 'settings';
    open.add('activity');
    setGroup('activity');
    paintChrome();
  }

  function paintAudit() {
    auditHost.replaceChildren(
      AuditPanel({
        entries: auditEntries,
        service: auditService,
        onService: (id) => {
          auditService = id;
          paintAudit();
        },
      }),
    );
  }

  /** Opens Export or Import, or goes back to the list with 'list'. */
  function showView(next) {
    if (next === view) return;
    sub?.stop?.();
    sub = null;
    view = next;
    if (next === 'export') sub = ExportConfig({ onChanged: refreshAudit });
    else if (next === 'import') sub = ImportConfig({ onClose: () => showView('list'), onImported: refreshAudit });
    subHost.replaceChildren(...(sub ? [sub.body] : []));
    paintHeader();
    paintChrome();
    if (!sub) listHost.querySelector('[data-summary="export"]')?.closest('.settings-row')?.scrollIntoView?.({ block: 'nearest' });
    else drawerBody.scrollTop = 0;
  }

  async function refreshAudit() {
    const log = await api.audit().catch(() => null);
    if (!log || !root || root.querySelector('.drawer-panel') !== panel) return;
    auditEntries = log.entries || [];
    paintChrome();
  }

  function paintHeader() {
    const titles = { export: 'Export config', import: 'Import config' };
    const parts = [];
    if (view !== 'list') {
      parts.push(
        Button({ variant: 'ghost', size: 'sm', square: true, 'aria-label': 'Back to settings', onClick: () => showView('list') }, Icon('back', { size: 16 })),
      );
    }
    parts.push(
      h('h2', { className: 'drawer-title font-display' }, titles[view] || 'Settings'),
      Button({ variant: 'ghost', size: 'sm', square: true, 'aria-label': 'Close', onClick: () => closeSettings() }, Icon('close', { size: 16 })),
    );
    headerHost.replaceChildren(...parts);
  }

  function paintChrome() {
    const inList = view === 'list';
    tabsHost.hidden = !inList;
    subHost.classList.toggle('settings-pane-hidden', inList);
    if (!inList) {
      tabsHost.replaceChildren();
      settingsTools.classList.add('settings-pane-hidden');
      listHost.classList.add('settings-pane-hidden');
      auditHost.classList.add('settings-pane-hidden');
      requestsHost.classList.add('settings-pane-hidden');
      requests.stop();
      footer.replaceChildren(sub.footer);
      return;
    }
    tabsHost.replaceChildren(SettingsTabs({ tab, count: auditEntries.length, onChange: (next) => {
      tab = next;
      paintChrome();
    } }));
    settingsTools.classList.toggle('settings-pane-hidden', tab !== 'settings');
    listHost.classList.toggle('settings-pane-hidden', tab !== 'settings');
    auditHost.classList.toggle('settings-pane-hidden', tab !== 'activity');
    requestsHost.classList.toggle('settings-pane-hidden', tab !== 'requests');
    // Only poll while the Requests tab is showing.
    if (tab === 'requests') requests.start();
    else requests.stop();
    if (tab === 'requests') {
      footer.replaceChildren(
        h('span', { className: 'audit-keep' }, 'Proxy requests across all services · updates live'),
        h('span', { className: 'drawer-footer-spacer' }),
        Button({ size: 'sm', className: 'btn-outline', onClick: showActivitySetting }, 'Change in Settings'),
      );
      return;
    }
    if (tab === 'activity') {
      footer.replaceChildren(
        h('span', { className: 'audit-keep' }, 'Keeping the last ', h('strong', {}, String(saved?.auditLimit ?? DEFAULT_AUDIT_LIMIT)), ' entries'),
        h('span', { className: 'drawer-footer-spacer' }),
        Button({ size: 'sm', className: 'btn-outline', onClick: showAuditSetting }, 'Change in Settings'),
      );
      paintAudit();
      return;
    }
    footer.replaceChildren(resetBtn, h('span', { className: 'drawer-footer-spacer' }), discardBtn, saveBtn);
  }

  const chipRow = h(
    'div',
    { className: 'settings-chips', role: 'group', 'aria-label': 'Setting groups' },
    ...SETTING_GROUPS.map(([id, label]) =>
      h(
        'button',
        {
          type: 'button',
          className: id === 'all' ? 'settings-chip is-active' : 'settings-chip',
          'data-group': id,
          'aria-pressed': id === 'all' ? 'true' : 'false',
          onClick: () => setGroup(id),
        },
        label,
      ),
    ),
  );

  const tabsHost = h('div');
  const settingsTools = h(
    'div',
    { className: 'settings-tools' },
    h(
      'label',
      { className: 'settings-search' },
      Icon('search', { size: 16, className: 'text-muted' }),
      h('input', {
        type: 'search',
        placeholder: 'Search settings',
        autocomplete: 'off',
        onInput: (e) => {
          query = e.target.value;
          paintList();
        },
      }),
    ),
    chipRow,
  );
  const auditHost = h('div', { className: 'audit-host settings-pane-hidden' });
  const requests = RequestsPanel();
  const requestsHost = h('div', { className: 'audit-host requests-host settings-pane-hidden' }, requests.el);
  const footer = h('div', { className: 'drawer-footer' });
  const headerHost = h('div', { className: 'drawer-header' });
  /** Export and Import fill this in place of the list. */
  const subHost = h('div', { className: 'bk-host settings-pane-hidden' });
  const drawerBody = h('div', { className: 'drawer-body' }, settingsTools, listHost, requestsHost, auditHost, subHost);

  const panel = h(
    'aside',
    {
      className: 'drawer-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Settings',
    },
    headerHost,
    tabsHost,
    drawerBody,
    footer,
  );

  const el = h(
    'div',
    {
      className: 'drawer-root',
      onClick: (e) => {
        if (e.target === el) closeSettings();
      },
    },
    panel,
  );

  paintHeader();
  paintList();
  paintChrome();
  onReady(el);
  api
    .settings()
    .then((data) => {
      if (!root || root !== el) return;
      saved = {
        rateLimit: clampRate(data.rateLimit),
        activityLimit: clampActivity(data.activityLimit),
        auditLimit: clampAudit(data.auditLimit),
        passwordLogin: data.passwordLogin !== false,
        embedOrigins: Array.isArray(data.embedOrigins) ? data.embedOrigins : [],
      };
      draft = { ...saved, embedOrigins: [...saved.embedOrigins] };
      showEmbed();
      oidcConfigured = !!data.oidc;
      oidcSession = !!data.oidcSession;
      encrypted = data.encrypted === true;
      loaded = true;
      loadError = '';
      if (sessionStorage.getItem('postern-password-off') === '1' && oidcConfigured) {
        sessionStorage.removeItem('postern-password-off');
        draft.passwordLogin = false;
        open.add('password');
        group = 'security';
        for (const chip of chipRow.querySelectorAll('[data-group]')) {
          const on = chip.dataset.group === group;
          chip.classList.toggle('is-active', on);
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      }
      paintList();
      paintChrome();
    })
    .catch((err) => {
      if (!root || root !== el) return;
      loadError = err.message || 'Could not load settings';
      paintList();
    });
  api
    .audit()
    .then((data) => {
      if (!root || root !== el) return;
      auditEntries = data.entries || [];
      if (auditService !== 'all' && !auditEntries.some((ev) => ev.service === auditService)) auditService = 'all';
      paintChrome();
    })
    .catch(() => {
      if (!root || root !== el) return;
      auditEntries = [];
      paintChrome();
    });

  return {
    isDirty,
    save,
    stop: () => {
      stopPoll();
      requests.stop();
      sub?.stop?.();
    },
    showTab: (next) => {
      if (!TABS.includes(next)) return;
      if (view !== 'list') showView('list');
      if (next === tab) return;
      tab = next;
      paintChrome();
    },
    inSubview: () => view !== 'list',
    back: () => showView('list'),
    markOIDC,
  };
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'postern-oidc') return;
  ctrl?.markOIDC?.();
});
