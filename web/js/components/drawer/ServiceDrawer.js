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
import {
  addAppAuth,
  authFromView,
  authToPayload,
  describeAddedSlots,
  describeAppAuth,
  emptyAuth,
  isAuthNone,
  missingAppAuth,
} from '../../lib/authPresets.js';
import { appInfo, appList } from '../../lib/apps.js';
import { ServiceIcon } from '../common/ServiceIcon.js';
import { defaultGate, gateFromView } from '../../lib/callerGate.js';
import { draftSnapshot, draftSaveBody, openPathCount } from '../../lib/drawerDraft.js';
import { copyValue } from '../../lib/clipboard.js';
import { toast } from '../common/Toast.js';
import { openDeleteDialog } from '../dialogs/DeleteServiceDialog.js';
import { askConfirm } from '../dialogs/ConfirmDialog.js';
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
    app: isEdit ? service.app || '' : '',
    icon: isEdit ? service.icon || '' : '',
  };
  // The last Test: null until one runs; { testing: true } while it runs; then { res } or { error }.
  let test = null;
  let testSeq = 0;

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
  // The Test result, attached under the upstream URL field. Empty until a test runs.
  const testCard = h('div', { className: 'test-card-host', 'aria-live': 'polite' });
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
    app: draft.app,
    icon: draft.icon,
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
      // A result belongs to the address that was tested.
      if (test) clearTest();
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

  // ---------- Test result ----------

  function clearTest() {
    test = null;
    testSeq++;
    urlField.classList.remove('has-test-card');
    testCard.replaceChildren();
  }

  /** What Set up would still change for the detected app: { app, missing }, or null. */
  function pendingSetup(info, appId) {
    const missing = missingAppAuth(draft.auth, info.auth);
    const needsApp = draft.app !== appId;
    if (!needsApp && !Object.keys(missing).length) return null;
    return { needsApp, missing };
  }

  function setUpApp(appId) {
    const info = appInfo(appId);
    if (!info) return;
    addAppAuth(draft.auth, info.auth);
    if (isAuthNone(draft.auth) && draft.access === 'upstream') draft.access = 'postern';
    draft.app = appId;
    if (!draft.name.trim() && !savedName) {
      draft.name = appId;
      nameInput.value = draft.name;
      header.update({ name: draft.name });
      updateHints();
      proxyInput.value = publicBase();
    }
    header.update({ app: draft.app });
    markDirty();
    if (activeTab === 'connection') renderConnection();
    else renderTestCard();
  }

  /** Why a test could not reach the address, from the server's errorKind: [title, detail]. */
  function unreachable(res) {
    switch (res?.errorKind) {
      case 'timeout':
        return ['No response · timed out after 5 s', 'Check the address, or that Postern can reach that network.'];
      case 'refused':
        return ['Connection refused', 'Nothing is listening at that address and port.'];
      case 'dns':
        return ['Address not found', 'Postern cannot resolve that host name.'];
      case 'tls':
        return ['Certificate not trusted', 'Postern does not trust the HTTPS certificate at that address.'];
      case 'redirect':
        return ['Too many redirects', 'The address kept redirecting.'];
      default:
        return ['Could not reach it', res?.error || ''];
    }
  }

  function renderTestCard() {
    if (!test) {
      urlField.classList.remove('has-test-card');
      testCard.replaceChildren();
      return;
    }
    urlField.classList.add('has-test-card');
    const status = (tone, icon, ...text) =>
      h('div', { className: `test-card-status is-${tone}` }, icon ? Icon(icon, { size: 14 }) : null, h('span', {}, ...text));

    if (test.testing) {
      testCard.replaceChildren(h('div', { className: 'test-card' }, status('muted', null, 'Testing…')));
      return;
    }
    if (test.error || !test.res?.ok) {
      const [title, detail] = test.error ? ['Could not test', test.error] : unreachable(test.res);
      testCard.replaceChildren(
        h(
          'div',
          { className: 'test-card' },
          status('danger', 'alert', title),
          detail ? h('p', { className: 'test-card-detail' }, detail) : null,
        ),
      );
      return;
    }

    const res = test.res;
    const d = res.detected;
    const info = d ? appInfo(d.app) : null;
    const appName = info ? `${info.label}${d.version ? ' ' + d.version : ''}` : '';
    const setup = info ? pendingSetup(info, d.app) : null;
    const line = res.authRejected
      ? status('warning', 'alert', `Reached${appName ? ' ' + appName : ''}, but it rejected the key · HTTP ${res.status}`)
      : status(
          'success',
          'check',
          ['Reachable', `HTTP ${res.status}`, appName].filter(Boolean).join(' · '),
          info && !setup ? h('span', { className: 'test-card-aside' }, ' · app and key match') : null,
        );
    const card = h('div', { className: 'test-card' }, line);

    if (info && setup) {
      const lead = info.auth
        ? [`${info.label} takes its key as `, h('strong', {}, describeAppAuth(info.auth)), '.']
        : [info.note || `${info.label} cannot be used with a key.`];
      const added = describeAddedSlots(setup.missing);
      const effect = [
        setup.needsApp ? `Sets the app to ${info.label}` : '',
        added ? `${setup.needsApp ? 'and adds' : 'Adds'} ${added} for you to fill in` : '',
      ]
        .filter(Boolean)
        .join(' ');
      card.append(
        h(
          'div',
          { className: 'test-card-body' },
          ServiceIcon({ name: info.label, app: d.app, size: 'md' }).el,
          h(
            'div',
            { className: 'test-card-text' },
            h('span', {}, ...lead),
            info.auth && info.keyHint
              ? h('span', { className: 'test-card-hint' }, `Find it in ${info.label}: ${info.keyHint}`)
              : null,
          ),
          Button({ size: 'sm', variant: 'primary', onClick: () => setUpApp(d.app) }, `Set up for ${info.label}`),
        ),
        effect ? h('p', { className: 'test-card-foot' }, `${effect}.`) : null,
      );
    }
    testCard.replaceChildren(card);
  }

  const iconFileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    hidden: true,
    onChange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 256 * 1024) {
        toast.error('That image is too large', { detail: 'Use a PNG, JPEG or WebP of 256 KB or less.' });
        return;
      }
      try {
        const res = await api.uploadIcon(file);
        draft.icon = res.icon;
        header.update({ icon: draft.icon });
        markDirty();
        if (activeTab === 'connection') renderConnection();
      } catch (err) {
        toast.error("Couldn't use that image", { detail: err.errors?.icon || err.message });
      }
    },
  });

  function iconPicker() {
    const preview = ServiceIcon({ name: draft.name || savedName || '?', app: draft.app, icon: draft.icon, size: 'lg' });
    const select = h(
      'select',
      {
        className: 'auth-row-select',
        id: 'svc-app',
        onChange: (e) => {
          draft.app = e.target.value;
          header.update({ app: draft.app });
          preview.update({ app: draft.app });
          markDirty();
          renderTestCard();
        },
      },
      h('option', { value: '', selected: !draft.app }, 'None'),
      ...appList().map((a) => h('option', { value: a.id, selected: draft.app === a.id }, a.label)),
      // An app this version does not list (from a newer Postern's file) stays selectable.
      draft.app && !appInfo(draft.app) ? h('option', { value: draft.app, selected: true }, draft.app) : null,
    );
    const actions = h(
      'div',
      { className: 'icon-picker-actions' },
      Button({ size: 'sm', onClick: () => iconFileInput.click() }, draft.icon ? 'Replace icon…' : 'Upload icon…'),
      draft.icon
        ? Button(
            {
              size: 'sm',
              variant: 'ghost',
              onClick: () => {
                draft.icon = '';
                header.update({ icon: '' });
                markDirty();
                renderConnection();
              },
            },
            'Remove custom icon',
          )
        : null,
    );
    return h(
      'div',
      { className: 'flex flex-col gap-1.5' },
      h('label', { className: 'field-label', htmlFor: 'svc-app' }, 'App and icon'),
      h('div', { className: 'icon-picker' }, preview.el, select, actions, iconFileInput),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        draft.icon
          ? 'The custom icon shows instead of the app’s.'
          : 'The app sets the icon. Upload a PNG, JPEG or WebP (up to 512×512, 256 KB) to use your own.',
      ),
    );
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
            // The result card hangs off the field, so the two sit together with no gap. It is
            // redrawn with the tab, since what is left to set up may have changed.
            renderTestCard();
            return h('div', { className: 'flex flex-col' }, urlField, testCard);
          })(),
          wasUrl,
        ),
        iconPicker(),
        AuthRowsEditor({
          auth: draft.auth,
          editing: !!savedName,
          serviceLabel: serviceLabel(),
          onChange: () => {
            if (isAuthNone(draft.auth) && draft.access === 'upstream') draft.access = 'postern';
            markDirty();
            renderTestCard();
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
    const seq = ++testSeq;
    test = { testing: true };
    renderTestCard();
    try {
      // Leave out slots with no key yet (typed or stored), such as ones Set up just added: the test
      // should still say whether the address answers, not that a key is missing.
      const auth = authToPayload({
        header: draft.auth.header?.secret || draft.auth.header?.stored ? draft.auth.header : null,
        query: draft.auth.query?.secret || draft.auth.query?.stored ? draft.auth.query : null,
        authz: draft.auth.authz?.secret || draft.auth.authz?.stored ? draft.auth.authz : null,
      });
      const res = await api.testConnection({ url: draft.url, auth, name: savedName || undefined });
      if (seq !== testSeq) return;
      test = { res };
    } catch (e) {
      if (seq !== testSeq) return;
      test = { error: e.message };
    }
    renderTestCard();
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
      draft.app = saved.app || '';
      draft.icon = saved.icon || '';
      nameInput.value = saved.name;
      baseline = snapshot();
      markDirty();
      renderDelete();
      proxyInput.value = publicBase();
      isEdit = true;
      origUrl = saved.url || draft.url;
      updateHints();
      panel.setAttribute('aria-label', `Edit ${savedName}`);
      header.update({ name: saved.name, app: draft.app, icon: draft.icon, enabled: draft.enabled, ...pagerState() });
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
    draft.app = svc.app || '';
    draft.icon = svc.icon || '';
    clearTest();
    nameInput.value = draft.name;
    urlInput.value = draft.url;
    panel.setAttribute('aria-label', `Edit ${svc.name}`);
    baseline = snapshot();
    errBox.textContent = '';
    proxyInput.value = publicBase();
    updateHints();
    renderDelete();
    paintChrome();
    header.update({ name: svc.name, app: draft.app, icon: draft.icon, enabled: draft.enabled, ...pagerState() });
    tabs.refresh();
    renderActiveTab();
  }

  const mod = isMac() ? '⌘' : 'Ctrl';
  const discardBtn = Button(
    {
      size: 'sm',
      onClick: async () => {
        if (isDirty()) {
          const ok = await askConfirm({
            title: savedName ? 'Discard your changes?' : 'Discard this service?',
            body: savedName
              ? `Your edits to ${savedName} are thrown away, and it goes back to how it was last saved.`
              : 'The new service has not been saved. What you entered is thrown away.',
            confirmLabel: 'Discard',
            cancelLabel: 'Keep editing',
            danger: true,
            trigger: discardBtn,
          });
          if (!ok) return;
        }
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
