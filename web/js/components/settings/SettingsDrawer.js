import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { api } from '../../api.js';
import { setState } from '../../state.js';
import { showToast } from '../common/Toast.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { SettingsAccordion } from './SettingsAccordion.js';
import { SettingControls } from './SettingControls.js';
import { SettingsTabs } from './SettingsTabs.js';
import { AuditPanel } from './AuditPanel.js';
import { PasswordLoginSetting } from './PasswordLoginSetting.js';
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
  activitySummary,
  clampActivity,
  clampAudit,
  clampRate,
  perSecondLabel,
  passwordSummary,
  rateSummary,
  settingVisible,
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

export function openSettings() {
  if (root) return;
  const gen = ++generation;
  ctrl = createController({
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

function createController({ onReady }) {
  let saved = null;
  let draft = {
    rateLimit: DEFAULT_RATE_LIMIT,
    activityLimit: DEFAULT_ACTIVITY_LIMIT,
    auditLimit: DEFAULT_AUDIT_LIMIT,
    passwordLogin: true,
  };
  let oidcConfigured = false;
  let oidcSession = false;
  let poll = 0;
  let query = '';
  let group = 'all';
  let tab = 'settings';
  let auditEntries = [];
  let auditService = 'all';
  const open = new Set(['rate']);
  let saving = false;
  let loaded = false;
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
    return draft.rateLimit !== saved.rateLimit || draft.activityLimit !== saved.activityLimit || draft.auditLimit !== saved.auditLimit || draft.passwordLogin !== saved.passwordLogin;
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

  function resetAll() {
    draft.rateLimit = DEFAULT_RATE_LIMIT;
    draft.activityLimit = DEFAULT_ACTIVITY_LIMIT;
    draft.auditLimit = DEFAULT_AUDIT_LIMIT;
    draft.passwordLogin = true;
    sync();
    paintList();
  }

  function discard() {
    if (!saved) return;
    draft = { ...saved };
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
    if (!loaded || !isDirty() || saving || passwordBlocked()) return;
    saving = true;
    sync();
    try {
      const payload = {
        rateLimit: draft.rateLimit,
        activityLimit: draft.activityLimit,
        auditLimit: draft.auditLimit,
      };
      if (oidcConfigured) payload.passwordLogin = draft.passwordLogin;
      const next = await api.saveSettings(payload);
      saved = {
        rateLimit: clampRate(next.rateLimit),
        activityLimit: clampActivity(next.activityLimit),
        auditLimit: clampAudit(next.auditLimit),
        passwordLogin: next.passwordLogin !== false,
      };
      oidcConfigured = !!next.oidc;
      oidcSession = !!next.oidcSession;
      draft = { ...saved };
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
    const rateSum = listHost.querySelector('[data-summary="rate"]');
    if (rateSum) rateSum.textContent = rateSummary(draft.rateLimit);
    const actSum = listHost.querySelector('[data-summary="activity"]');
    if (actSum) actSum.textContent = activitySummary(draft.activityLimit);
    const auditSum = listHost.querySelector('[data-summary="audit"]');
    if (auditSum) auditSum.textContent = activitySummary(draft.auditLimit);
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
    const dirty = isDirty();
    discardBtn.disabled = !dirty || saving;
    saveBtn.disabled = !dirty || saving || !loaded || passwordBlocked();
    resetBtn.disabled = saving || !loaded;
  }

  function paintList() {
    listHost.replaceChildren();
    if (!loaded) {
      listHost.append(h('p', { className: 'settings-empty' }, loadError || 'Loading settings…'));
      return;
    }
    let shown = 0;
    let lastGroup = '';
    for (const def of SETTING_DEFS) {
      if (group !== 'all' && def.group !== group) continue;
      if (!settingVisible(query, def)) continue;
      if (def.group !== lastGroup) {
        listHost.append(h('h3', { className: 'settings-group' }, def.groupLabel));
        lastGroup = def.group;
      }
      const isOpen = open.has(def.id);
      const body = def.id === 'rate' ? rateBody() : def.id === 'audit' ? auditBody() : def.id === 'password' ? passwordBody() : activityBody();
      listHost.append(
        SettingsAccordion(
          {
            id: def.id,
            title: def.title,
            hint: def.hint,
            summary:
              def.id === 'rate'
                ? rateSummary(draft.rateLimit)
                : def.id === 'password'
                  ? passwordSummary(oidcConfigured ? draft.passwordLogin : true)
                  : activitySummary(def.id === 'audit' ? draft.auditLimit : draft.activityLimit),
            open: isOpen,
            onToggle: () => {
              if (open.has(def.id)) open.delete(def.id);
              else open.add(def.id);
              paintList();
            },
          },
          isOpen ? body : null,
        ),
      );
      shown += 1;
    }
    if (!shown) listHost.append(h('p', { className: 'settings-empty' }, 'No matching settings.'));
    sync();
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
      label: 'Activity history',
      value: draft.activityLimit,
      min: 1,
      max: MAX_ACTIVITY_LIMIT,
      presets: ACTIVITY_PRESETS,
      note: 'Kept per service. Lowering this trims older requests on save.',
      detail: 'The Recent column and the Usage list read this log. Query secrets are already redacted.',
      fieldName: `settings.activityLimit · default ${DEFAULT_ACTIVITY_LIMIT}`,
      isDefault: draft.activityLimit === DEFAULT_ACTIVITY_LIMIT,
      onChange: setActivity,
      onDefault: () => setActivity(DEFAULT_ACTIVITY_LIMIT),
    });
  }

  function auditBody() {
    return SettingControls({
      field: 'audit',
      label: 'Audit log',
      value: draft.auditLimit,
      min: 1,
      max: MAX_AUDIT_LIMIT,
      presets: AUDIT_PRESETS,
      note: 'Newest admin changes stay. Older lines are dropped on save.',
      detail: 'The Activity tab reads this log. It does not include secrets.',
      fieldName: `settings.auditLimit · default ${DEFAULT_AUDIT_LIMIT}`,
      isDefault: draft.auditLimit === DEFAULT_AUDIT_LIMIT,
      onChange: setAudit,
      onDefault: () => setAudit(DEFAULT_AUDIT_LIMIT),
    });
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

  function paintChrome() {
    tabsHost.replaceChildren(SettingsTabs({ tab, count: auditEntries.length, onChange: (next) => {
      tab = next;
      paintChrome();
    } }));
    settingsTools.classList.toggle('settings-pane-hidden', tab !== 'settings');
    listHost.classList.toggle('settings-pane-hidden', tab !== 'settings');
    auditHost.classList.toggle('settings-pane-hidden', tab !== 'activity');
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
    ...[
      ['all', 'All'],
      ['traffic', 'Traffic'],
      ['activity', 'Activity'],
      ['signin', 'Sign-in'],
    ].map(([id, label]) =>
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
  const footer = h('div', { className: 'drawer-footer' });

  const panel = h(
    'aside',
    {
      className: 'drawer-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Settings',
    },
    h(
      'div',
      { className: 'drawer-header' },
      h('h2', { className: 'drawer-title font-display' }, 'Settings'),
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          square: true,
          'aria-label': 'Close',
          onClick: () => closeSettings(),
        },
        Icon('close', { size: 16 }),
      ),
    ),
    tabsHost,
    h('div', { className: 'drawer-body' }, settingsTools, listHost, auditHost),
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
      };
      draft = { ...saved };
      oidcConfigured = !!data.oidc;
      oidcSession = !!data.oidcSession;
      loaded = true;
      loadError = '';
      if (sessionStorage.getItem('postern-password-off') === '1' && oidcConfigured) {
        sessionStorage.removeItem('postern-password-off');
        draft.passwordLogin = false;
        open.add('password');
        group = 'signin';
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

  return { isDirty, save, stop: stopPoll, markOIDC };
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'postern-oidc') return;
  ctrl?.markOIDC?.();
});
