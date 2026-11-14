import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { AuthRowsEditor } from './AuthRowsEditor.js';
import { AccessPanel } from './AccessPanel.js';
import { UsagePanel } from './UsagePanel.js';
import { DocsPanel } from './DocsPanel.js';
import { OpenPathsEditor } from './OpenPathsEditor.js';
import { ServiceDrawerHeader } from './ServiceDrawerHeader.js';
import { ServiceDrawerTabs } from './ServiceDrawerTabs.js';
import { api } from '../../api.js';
import { rise } from '../../lib/motion.js';
import { slugify } from '../../lib/slug.js';
import { authFromView, authToPayload, emptyAuth, isAuthNone } from '../../lib/authPresets.js';
import { defaultGate, gateFromView } from '../../lib/callerGate.js';
import { draftSnapshot, draftSaveBody, openPathCount } from '../../lib/drawerDraft.js';
import { copyValue } from '../../lib/clipboard.js';
import { toast } from '../common/Toast.js';
import { openDeleteDialog } from '../dialogs/DeleteServiceDialog.js';
import { askUnsavedChanges } from '../dialogs/UnsavedChangesDialog.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { setState, state, filteredServices } from '../../state.js';

let root = null;
let ctrl = null;

const TABS = [
  { id: 'connection', label: 'Connection', icon: 'plug' },
  { id: 'access', label: 'Access', icon: 'lock' },
  { id: 'advanced', label: 'Advanced', icon: 'gear' },
  { id: 'usage', label: 'Requests', icon: 'pulse' },
  { id: 'docs', label: 'How to use', icon: 'book' },
];

/** @returns {boolean} */
export function isDrawerOpen() {
  return !!root;
}

export function isDrawerDirty() {
  return ctrl?.isDirty?.() || false;
}

export function getDrawerMode() {
  return ctrl?.mode || null;
}

export function getDrawerName() {
  return ctrl?.savedName || ctrl?.draft?.name || null;
}

/**
 * Open create or edit drawer. Remounts if already open.
 * handlers: { onSaved, onDeleted, onClose, onNavigate(delta) }
 */
export function openServiceDrawer({ mode = 'edit', service = null, handlers = {} }) {
  closeServiceDrawer({ skipConfirm: true, keepFocus: true });
  ctrl = createController({ mode, service, handlers });
  root = ctrl.el;
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('drawer-open'));
  setState({
    drawer: { mode: ctrl.mode, name: ctrl.savedName || null },
    drawerDirty: false,
  });
}

async function resolveUnsaved() {
  if (!ctrl?.isDirty?.()) return 'discard';
  const choice = await askUnsavedChanges();
  if (choice === 'save') {
    const ok = await ctrl.save();
    return ok ? 'save' : 'cancel';
  }
  return choice;
}

/**
 * Close the drawer. The highlighted row is cleared with it, except when the
 * drawer is only being remounted for another row (`keepFocus`).
 */
export async function closeServiceDrawer({ skipConfirm = false, keepFocus = false } = {}) {
  if (!root) return true;
  if (!skipConfirm) {
    const choice = await resolveUnsaved();
    if (choice === 'cancel') return false;
  }
  root.classList.remove('drawer-open');
  const el = root;
  root = null;
  ctrl = null;
  setState({ drawer: null, drawerDirty: false, ...(keepFocus ? {} : { focusIndex: -1 }) });
  setTimeout(() => el.remove(), 180);
  return true;
}

/** Switch edit target (J/K). Returns false if blocked by dirty confirm. */
export async function navigateDrawer(service) {
  if (!ctrl || ctrl.mode !== 'edit') return false;
  const choice = await resolveUnsaved();
  if (choice === 'cancel') return false;
  ctrl.loadService(service);
  const idx = filteredServices().findIndex((s) => s.name === service.name);
  setState({
    drawer: { mode: 'edit', name: service.name },
    drawerDirty: false,
    focusIndex: idx >= 0 ? idx : state.focusIndex,
  });
  return true;
}

export function requestDrawerSave() {
  return ctrl?.save?.();
}

function createController({ mode, service, handlers }) {
  let isEdit = mode === 'edit' && !!service;
  let savedName = isEdit ? service.name : null;
  let token = isEdit ? service.token || '' : '';
  let tokens = isEdit && Array.isArray(service.tokens) ? service.tokens : [];
  let baseline = null;
  let origUrl = isEdit ? service.url || '' : '';
  let activeTab = 'connection';
  let fieldErrors = null;

  const draft = {
    name: isEdit ? service.name : '',
    url: isEdit ? service.url || '' : '',
    enabled: isEdit ? !!service.enabled : true,
    access: isEdit && service.access === 'upstream' ? 'upstream' : 'postern',
    openPaths: isEdit
      ? (service.openPaths || []).map((p) => ({
          match: p.match === 'regex' ? 'regex' : 'prefix',
          path: p.path || '',
        }))
      : [],
    auth: isEdit ? authFromView(service.auth) : emptyAuth(),
    gate: isEdit ? gateFromView(service.gate) : defaultGate(),
  };

  function snapshot() {
    return draftSnapshot(draft);
  }

  baseline = snapshot();

  function isDirty() {
    return snapshot() !== baseline;
  }

  function dirtyCount() {
    return isDirty() ? 1 : 0;
  }

  function serviceLabel() {
    return slugify(draft.name) || draft.name || savedName || 'service';
  }

  function publicBase() {
    const name = slugify(draft.name) || draft.name || savedName || '<name>';
    const origin = state.meta.publicOrigin || location.origin;
    return `${origin.replace(/\/$/, '')}/p/${name}/`;
  }

  function pathCount() {
    return openPathCount(draft);
  }

  function markDirty() {
    setState({ drawerDirty: isDirty() });
    paintChrome();
  }

  function pagerState() {
    const items = filteredServices();
    if (!isEdit || !savedName || !items.length) {
      return { index: -1, total: 0, canPage: false };
    }
    const index = items.findIndex((s) => s.name === savedName);
    return { index, total: items.length, canPage: items.length > 1 };
  }

  // Hidden while empty so it does not hold a blank line (plus the panel gap) under every tab.
  const errBox = h('p', { className: 'text-danger text-sm m-0 min-h-5 px-1 empty:hidden' });
  const testResult = h('p', { className: 'text-sm m-0 min-h-5' });
  const wasUrl = h('p', { className: 'm-0 text-xs text-muted' });
  const renameHint = h('p', { className: 'm-0 text-xs text-muted leading-relaxed' });
  const dirtyLabel = h('span', { className: 'drawer-dirty-label' }, '');
  const panelHost = h('div', { className: 'drawer-tab-panel flex flex-col gap-4' });
  const proxyInput = h('input', {
    className: 'copy-field-value',
    type: 'text',
    readOnly: true,
    value: publicBase(),
    'aria-label': 'Proxy URL',
    onFocus: (e) => e.currentTarget.select(),
  });
  const proxyCopyBtn = h(
    'button',
    {
      type: 'button',
      className: 'copy-field-btn',
      onClick: async () => {
        try {
          await copyValue(publicBase());
        } catch {
          /* toast already shown */
        }
      },
    },
    Icon('copy', { size: 14 }),
    'Copy',
  );
  const proxyField = h('div', { className: 'copy-field' }, proxyInput, proxyCopyBtn);
  const deleteHost = h('div', { className: 'drawer-footer-delete' });

  let accessPanel = null;
  let usagePanel = null;
  let docsPanel = null;

  const header = ServiceDrawerHeader({
    name: isEdit ? service.name : 'New service',
    enabled: draft.enabled,
    ...pagerState(),
    onToggle: (on) => setLive(on),
    onPrev: () => handlers.onNavigate?.(-1),
    onNext: () => handlers.onNavigate?.(1),
    onClose: async () => {
      if (await closeServiceDrawer()) handlers.onClose?.();
    },
  });

  const tabs = ServiceDrawerTabs({
    tabs: TABS,
    activeId: activeTab,
    getBadge: (id) => (id === 'advanced' ? pathCount() : 0),
    onSelect: (id) => {
      if (activeTab === id) return;
      activeTab = id;
      renderActiveTab();
      rise(panelHost.firstElementChild, { y: 6, duration: 0.26, max: 1 });
    },
  });

  const nameInput = h('input', {
    className: 'input w-full font-mono',
    value: draft.name,
    placeholder: 'sonarr',
    onInput: (e) => {
      draft.name = e.target.value;
      const label = slugify(draft.name) || draft.name || (isEdit ? savedName : 'New service');
      header.update({ name: label });
      updateHints();
      proxyInput.value = publicBase();
      if (activeTab === 'access') renderAccess();
      if (activeTab === 'usage') renderUsage();
      if (activeTab === 'docs') renderDocs();
      markDirty();
    },
  });

  const urlInput = h('input', {
    className: 'copy-field-value',
    value: draft.url,
    placeholder: 'http://192.168.1.10:8989',
    'aria-label': 'Upstream URL',
    onInput: (e) => {
      draft.url = e.target.value;
      updateHints();
      markDirty();
    },
  });
  const urlTestBtn = h(
    'button',
    {
      type: 'button',
      className: 'copy-field-btn',
      onClick: () => runTest(),
    },
    Icon('pulse', { size: 14 }),
    'Test',
  );
  const urlField = h('div', { className: 'copy-field' }, urlInput, urlTestBtn);

  async function setLive(on) {
    const next = !!on;
    if (draft.enabled === next) return;
    const prev = draft.enabled;
    draft.enabled = next;
    header.update({ enabled: next });
    if (!savedName) return;
    const optimistic = state.services.map((s) => (s.name === savedName ? { ...s, enabled: next } : s));
    setState({ services: optimistic });
    try {
      const updated = await api.setEnabled(savedName, next);
      setState({
        services: state.services.map((s) => (s.name === savedName ? updated : s)),
      });
      draft.enabled = !!updated.enabled;
      header.update({ enabled: draft.enabled });
    } catch (err) {
      draft.enabled = prev;
      header.update({ enabled: prev });
      setState({
        services: state.services.map((s) => (s.name === savedName ? { ...s, enabled: prev } : s)),
      });
      toast.error("Couldn't change the status", { detail: err.message });
    }
  }

  function updateHints() {
    const slug = slugify(draft.name) || draft.name;
    if (isEdit && slug && savedName && slug !== savedName) {
      renameHint.replaceChildren(
        document.createTextNode('Renaming changes the public route — callers using '),
        h('span', { className: 'font-mono' }, `/p/${savedName}/`),
        document.createTextNode(' would need the new one.'),
      );
    } else if (!isEdit) {
      renameHint.textContent = slug
        ? `Public route will be /p/${slug}/`
        : 'The name becomes the public route, like /p/sonarr/.';
    } else {
      renameHint.textContent = '';
    }
    nameInput.classList.toggle('is-changed', !!(isEdit && slug && savedName && slug !== savedName));

    const urlChanged =
      !!draft.url.trim() && !!origUrl && draft.url.trim().replace(/\/$/, '') !== origUrl.replace(/\/$/, '');
    urlField.classList.toggle('is-changed', urlChanged);
    if (urlChanged) {
      wasUrl.replaceChildren(
        h('span', { className: 'inline-block w-1.5 h-1.5 rounded-full bg-warning mr-1.5 align-middle' }),
        h('span', { className: 'line-through' }, `was ${origUrl}`),
      );
    } else {
      wasUrl.replaceChildren();
    }
  }

  function renderActiveTab() {
    if (activeTab === 'connection') renderConnection();
    else if (activeTab === 'access') renderAccess();
    else if (activeTab === 'advanced') renderAdvanced();
    else if (activeTab === 'docs') renderDocs();
    else renderUsage();
  }

  function renderConnection() {
    panelHost.replaceChildren(
      h(
        'div',
        { className: 'flex flex-col gap-3' },
        h(
          'div',
          { className: 'flex flex-col gap-1.5' },
          h('label', { className: 'field-label' }, 'Name'),
          nameInput,
          renameHint,
        ),
        h(
          'div',
          { className: 'flex flex-col gap-1.5' },
          h('label', { className: 'field-label', htmlFor: 'svc-proxy-url' }, 'Proxy URL'),
          (() => {
            proxyInput.id = 'svc-proxy-url';
            proxyInput.readOnly = true;
            proxyInput.value = publicBase();
            return proxyField;
          })(),
        ),
        h(
          'div',
          { className: 'flex flex-col gap-1.5' },
          h('label', { className: 'field-label', htmlFor: 'svc-upstream-url' }, 'Upstream URL'),
          (() => {
            urlInput.id = 'svc-upstream-url';
            return urlField;
          })(),
          wasUrl,
          testResult,
        ),
        AuthRowsEditor({
          auth: draft.auth,
          editing: !!savedName,
          showPresets: !savedName,
          serviceLabel: serviceLabel(),
          onChange: () => {
            if (isAuthNone(draft.auth) && draft.access === 'upstream') draft.access = 'postern';
            markDirty();
          },
        }),
        errBox,
      ),
    );
  }

  function renderAccess() {
    accessPanel = AccessPanel({
      draft,
      token,
      tokens,
      savedName,
      serviceLabel,
      onChange: () => {
        markDirty();
        if (activeTab === 'docs') renderDocs();
      },
      onTokensUpdated: (svc) => {
        token = svc.token || '';
        tokens = svc.tokens || [];
        setState({
          services: state.services.map((s) => (s.name === savedName ? { ...s, token, tokens } : s)),
        });
        renderAccess();
      },
    });
    panelHost.replaceChildren(accessPanel, errBox);
  }

  function renderAdvanced() {
    panelHost.replaceChildren(
      h(
        'div',
        { className: 'open-paths-panel flex flex-col gap-3' },
        h('span', { className: 'label-caps' }, 'Open paths'),
        h(
          'p',
          { className: 'm-0 text-[13px] text-muted leading-relaxed' },
          'These paths skip the caller token. The upstream credential is still added.',
        ),
        OpenPathsEditor({
          paths: draft.openPaths,
          errors: fieldErrors,
          onChange: () => {
            markDirty();
            tabs.refresh();
            if (activeTab === 'docs') renderDocs();
          },
        }),
      ),
      errBox,
    );
  }

  function renderUsage() {
    usagePanel = UsagePanel({ savedName });
    panelHost.replaceChildren(usagePanel, errBox);
  }

  function renderDocs() {
    docsPanel = DocsPanel({ draft });
    panelHost.replaceChildren(docsPanel, errBox);
  }

  function renderDelete() {
    if (!savedName) {
      deleteHost.replaceChildren();
      deleteHost.hidden = true;
      return;
    }
    deleteHost.hidden = false;
    deleteHost.replaceChildren(
      h(
        'button',
        {
          type: 'button',
          className: 'drawer-delete-link',
          'aria-label': `Delete ${savedName}`,
          onClick: () =>
            openDeleteDialog({
              service: { name: savedName },
              onDeleted: () => {
                closeServiceDrawer({ skipConfirm: true });
                handlers.onDeleted?.(savedName);
              },
            }),
        },
        h('span', { className: 'drawer-delete-label' }, `Delete ${savedName}…`),
      ),
    );
  }

  async function runTest() {
    testResult.textContent = 'Testing…';
    testResult.className = 'text-sm m-0 min-h-5 text-muted';
    try {
      const res = await api.testConnection({
        url: draft.url,
        auth: authToPayload(draft.auth),
        name: savedName || undefined,
      });
      if (res.authRejected) {
        testResult.className = 'text-sm m-0 min-h-5 text-warning';
        testResult.textContent = res.warning || `Reached the service, but it rejected the credential (HTTP ${res.status})`;
      } else if (res.ok) {
        testResult.className = 'text-sm m-0 min-h-5 text-success';
        testResult.textContent = `✓ Reachable · HTTP ${res.status}`;
      } else {
        testResult.className = 'text-sm m-0 min-h-5 text-danger';
        testResult.textContent = res.error || 'Unreachable';
      }
    } catch (e) {
      testResult.className = 'text-sm m-0 min-h-5 text-danger';
      testResult.textContent = e.message;
    }
  }

  async function save() {
    errBox.textContent = '';
    fieldErrors = null;
    const body = draftSaveBody(draft);
    try {
      const creating = !savedName;
      const prevName = savedName;
      let saved;
      if (savedName) {
        saved = await api.updateService(savedName, body);
      } else {
        saved = await api.createService(body);
      }
      savedName = saved.name;
      token = saved.token || token;
      tokens = saved.tokens || tokens;
      draft.name = saved.name;
      draft.enabled = !!saved.enabled;
      nameInput.value = saved.name;
      baseline = snapshot();
      markDirty();
      renderDelete();
      proxyInput.value = publicBase();
      isEdit = true;
      origUrl = saved.url || draft.url;
      updateHints();
      panel.setAttribute('aria-label', `Edit ${savedName}`);
      header.update({ name: saved.name, enabled: draft.enabled, ...pagerState() });
      tabs.refresh();
      handlers.onSaved?.(saved, { created: creating, renamed: !!(prevName && saved.name !== prevName) });
      toast.success(creating ? 'Service created' : 'Service saved', { detail: savedName });
      setState({ drawer: { mode: 'edit', name: savedName } });
      renderActiveTab();
      return true;
    } catch (e) {
      fieldErrors = e.errors || null;
      errBox.textContent = e.errors ? Object.values(e.errors).join(' · ') : e.message;
      if (fieldErrors && activeTab === 'advanced') renderAdvanced();
      return false;
    }
  }

  function loadService(svc) {
    service = svc;
    isEdit = true;
    savedName = svc.name;
    token = svc.token || '';
    tokens = svc.tokens || [];
    origUrl = svc.url || '';
    draft.name = svc.name;
    draft.url = svc.url || '';
    draft.enabled = !!svc.enabled;
    draft.access = svc.access === 'upstream' ? 'upstream' : 'postern';
    draft.openPaths = (svc.openPaths || []).map((p) => ({
      match: p.match === 'regex' ? 'regex' : 'prefix',
      path: p.path || '',
    }));
    draft.auth = authFromView(svc.auth);
    draft.gate = gateFromView(svc.gate);
    nameInput.value = draft.name;
    urlInput.value = draft.url;
    panel.setAttribute('aria-label', `Edit ${svc.name}`);
    baseline = snapshot();
    errBox.textContent = '';
    testResult.textContent = '';
    proxyInput.value = publicBase();
    updateHints();
    renderDelete();
    paintChrome();
    header.update({ name: svc.name, enabled: draft.enabled, ...pagerState() });
    tabs.refresh();
    renderActiveTab();
  }

  const mod = isMac() ? '⌘' : 'Ctrl';
  const discardBtn = Button(
    {
      size: 'sm',
      onClick: () => {
        if (isDirty() && !confirm('Discard unsaved changes?')) return;
        if (savedName) {
          const svc = state.services.find((s) => s.name === savedName);
          if (svc) loadService(svc);
          else void closeServiceDrawer({ skipConfirm: true });
        } else {
          void closeServiceDrawer({ skipConfirm: true });
          handlers.onClose?.();
        }
      },
    },
    'Discard',
  );
  const saveBtn = Button(
    {
      variant: 'primary',
      size: 'sm',
      className: 'gap-1.5',
      onClick: () => save(),
    },
    'Save',
    h('kbd', { className: 'kbd-hint kbd-hint-on-primary' }, `${mod}S`),
  );

  function paintChrome() {
    const dirty = isDirty();
    const n = dirtyCount();
    const creating = !savedName;
    dirtyLabel.textContent = n ? `● ${n} unsaved change${n === 1 ? '' : 's'}` : '';
    dirtyLabel.className = n ? 'drawer-dirty-label is-dirty' : 'drawer-dirty-label';
    // Edit: Save/Discard only when dirty. Add: Save always on; Discard always on.
    discardBtn.disabled = creating ? false : !dirty;
    saveBtn.disabled = creating ? false : !dirty;
    header.update({ ...pagerState(), enabled: draft.enabled });
  }

  const footer = h(
    'div',
    { className: 'drawer-footer' },
    deleteHost,
    dirtyLabel,
    h('div', { className: 'flex items-center gap-2 ml-auto' }, discardBtn, saveBtn),
  );

  updateHints();
  renderActiveTab();
  renderDelete();
  paintChrome();

  const panel = h(
    'aside',
    {
      className: 'drawer-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': isEdit ? `Edit ${service.name}` : 'Add service',
    },
    header.el,
    tabs.el,
    h('div', { className: 'drawer-body' }, panelHost),
    footer,
  );

  const el = h(
    'div',
    {
      className: 'drawer-root',
      onClick: async (e) => {
        if (e.target === el) {
          if (await closeServiceDrawer()) handlers.onClose?.();
        }
      },
    },
    panel,
  );

  return {
    el,
    get mode() {
      return savedName ? 'edit' : 'create';
    },
    set mode(_v) {},
    get savedName() {
      return savedName;
    },
    draft,
    isDirty,
    save,
    loadService,
  };
}
