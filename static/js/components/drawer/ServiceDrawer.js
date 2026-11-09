import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { AuthRowsEditor } from './AuthRowsEditor.js';
import { OpenPathsEditor } from '../form/OpenPathsEditor.js';
import { api } from '../../api.js';
import { slugify } from '../../lib/slug.js';
import { authFromView, authToPayload, emptyAuth, isAuthNone } from '../../lib/authPresets.js';
import { copyText } from '../../lib/clipboard.js';
import { showToast } from '../common/Toast.js';
import { openRotateDialog } from '../dialogs/RotateTokenDialog.js';
import { openDeleteDialog } from '../dialogs/DeleteServiceDialog.js';
import { isMac } from '../../lib/serviceDisplay.js';
import { setState, state, filteredServices } from '../../state.js';

let root = null;
let ctrl = null;

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
  closeServiceDrawer({ skipConfirm: true });
  ctrl = createController({ mode, service, handlers });
  root = ctrl.el;
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('drawer-open'));
  setState({
    drawer: { mode: ctrl.mode, name: ctrl.savedName || null },
    drawerDirty: false,
  });
}

export function closeServiceDrawer({ skipConfirm = false } = {}) {
  if (!root) return true;
  if (!skipConfirm && ctrl?.isDirty?.()) {
    if (!confirm('Discard unsaved changes?')) return false;
  }
  root.classList.remove('drawer-open');
  const el = root;
  root = null;
  ctrl = null;
  setState({ drawer: null, drawerDirty: false });
  setTimeout(() => el.remove(), 180);
  return true;
}

/** Switch edit target (J/K). Returns false if blocked by dirty confirm. */
export function navigateDrawer(service) {
  if (!ctrl || ctrl.mode !== 'edit') return false;
  if (ctrl.isDirty() && !confirm('Discard unsaved changes?')) return false;
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
  let baseline = null;
  let origUrl = isEdit ? service.url || '' : '';

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
  };

  function snapshot() {
    return JSON.stringify({
      name: slugify(draft.name) || draft.name,
      url: draft.url.trim(),
      enabled: draft.enabled,
      access: draft.access,
      openPaths: draft.openPaths
        .filter((p) => (p.path || '').trim())
        .map((p) => ({ match: p.match === 'regex' ? 'regex' : 'prefix', path: p.path.trim() })),
      auth: authToPayload(draft.auth),
    });
  }

  baseline = snapshot();

  function isDirty() {
    return snapshot() !== baseline;
  }

  function dirtyCount() {
    // coarse: 1 if any change
    return isDirty() ? 1 : 0;
  }

  function markDirty() {
    setState({ drawerDirty: isDirty() });
    paintChrome();
  }

  const titleEl = h('h2', { className: 'drawer-title font-display m-0' }, isEdit ? service.name : 'New service');
  const prevBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn btn-ghost btn-square btn-sm',
      'aria-label': 'Previous service',
      disabled: !isEdit,
      onClick: () => handlers.onNavigate?.(-1),
    },
    Icon('chevron', { size: 16, className: 'rotate-180' }),
  );
  const nextBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn btn-ghost btn-square btn-sm',
      'aria-label': 'Next service',
      disabled: !isEdit,
      onClick: () => handlers.onNavigate?.(1),
    },
    Icon('chevron', { size: 16 }),
  );
  const errBox = h('p', { className: 'text-danger-text text-sm m-0 min-h-5' });
  const testResult = h('p', { className: 'text-sm m-0 min-h-5' });
  const wasUrl = h('p', { className: 'm-0 text-xs text-muted' });
  const renameHint = h('p', { className: 'm-0 text-xs text-muted leading-relaxed' });
  const dirtyLabel = h('span', { className: 'drawer-dirty-label' }, '');
  const bodyHost = h('div', { className: 'drawer-body flex flex-col gap-5' });
  const tokenHost = h('div', { className: 'drawer-section flex flex-col gap-2' });
  const deleteHost = h('div', { className: 'drawer-section' });
  const authHost = h('div', { className: 'drawer-section' });
  const accessHost = h('div', { className: 'drawer-section flex flex-col gap-2' });
  const pathsHost = h('div', { className: 'drawer-section flex flex-col gap-2' });

  const nameInput = h('input', {
    className: 'input w-full font-mono',
    value: draft.name,
    placeholder: 'sonarr',
    onInput: (e) => {
      draft.name = e.target.value;
      titleEl.textContent = slugify(draft.name) || draft.name || (isEdit ? savedName : 'New service');
      updateHints();
      renderAccess();
      markDirty();
    },
  });

  const urlInput = h('input', {
    className: 'input w-full font-mono flex-1 min-w-0',
    value: draft.url,
    placeholder: 'http://192.168.1.10:8989',
    onInput: (e) => {
      draft.url = e.target.value;
      updateHints();
      markDirty();
    },
  });

  const liveToggle = h('input', {
    type: 'checkbox',
    className: 'toggle toggle-sm',
    checked: draft.enabled,
    'aria-label': 'Live',
    onChange: (e) => {
      draft.enabled = e.target.checked;
      markDirty();
    },
  });

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
      renameHint.textContent = `Public route: /p/${savedName}/`;
    }

    if (draft.url.trim() && origUrl && draft.url.trim().replace(/\/$/, '') !== origUrl.replace(/\/$/, '')) {
      wasUrl.replaceChildren(
        h('span', { className: 'inline-block w-1.5 h-1.5 rounded-full bg-warn mr-1.5 align-middle' }),
        h('span', { className: 'line-through' }, `was ${origUrl}`),
      );
    } else {
      wasUrl.replaceChildren();
    }
  }

  function renderAuth() {
    authHost.replaceChildren(
      AuthRowsEditor({
        auth: draft.auth,
        editing: !!savedName,
        serviceLabel: slugify(draft.name) || draft.name || savedName || 'service',
        onChange: () => {
          if (isAuthNone(draft.auth) && draft.access === 'upstream') draft.access = 'postern';
          renderAccess();
          markDirty();
        },
      }),
    );
  }

  function renderAccess() {
    const label = slugify(draft.name) || draft.name || savedName || 'service';
    const upstreamDisabled = isAuthNone(draft.auth);
    accessHost.replaceChildren(
      h('span', { className: 'label-caps' }, 'Callers get in with'),
      h(
        'div',
        { className: 'access-seg', role: 'radiogroup', 'aria-label': 'Caller access' },
        segBtn('postern', 'Postern token', draft.access === 'postern', false, () => {
          draft.access = 'postern';
          renderAccess();
          markDirty();
        }),
        segBtn('upstream', `Same as ${label}`, draft.access === 'upstream', upstreamDisabled, () => {
          if (upstreamDisabled) return;
          draft.access = 'upstream';
          renderAccess();
          markDirty();
        }),
      ),
    );
  }

  function segBtn(id, label, selected, disabled, onClick) {
    return h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': selected,
        disabled,
        className: `access-seg-btn${selected ? ' access-seg-active' : ''}${disabled ? ' opacity-40' : ''}`,
        onClick,
      },
      label,
    );
  }

  function renderPaths() {
    pathsHost.replaceChildren(
      h('span', { className: 'label-caps' }, 'Open paths'),
      h('p', { className: 'm-0 text-xs text-muted' }, 'Skip caller token on these paths; upstream credential still attached.'),
      OpenPathsEditor({
        paths: draft.openPaths,
        onChange: () => markDirty(),
      }),
    );
  }

  function renderToken() {
    if (!savedName || !token) {
      tokenHost.replaceChildren();
      return;
    }
    const masked = token.length > 8 ? token.slice(0, 4) + '••••••••••••••••' : '••••••••';
    tokenHost.replaceChildren(
      h('span', { className: 'label-caps' }, 'Caller token'),
      h(
        'div',
        { className: 'flex flex-wrap items-center gap-2' },
        h('code', { className: 'font-mono text-[13px] text-cream-dim flex-1 min-w-0 truncate' }, masked),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: async () => {
              try {
                await copyText(token);
                showToast('Token copied');
              } catch {
                showToast('Copy failed', 'error');
              }
            },
          },
          'Copy',
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-square',
            'aria-label': 'Rotate token',
            title: 'Rotate token',
            onClick: () =>
              openRotateDialog({
                service: { name: savedName, token },
                onRotated: (updated) => {
                  token = updated.token;
                  setState({
                    services: state.services.map((s) => (s.name === savedName ? { ...s, token: updated.token } : s)),
                  });
                  renderToken();
                },
              }),
          },
          Icon('rotate', { size: 16 }),
        ),
      ),
    );
  }

  function renderDelete() {
    if (!savedName) {
      deleteHost.replaceChildren();
      deleteHost.hidden = true;
      return;
    }
    deleteHost.hidden = false;
    deleteHost.replaceChildren(
      h('span', { className: 'label-caps' }, 'Remove'),
      h(
        'div',
        { className: 'drawer-inline-row' },
        h('p', { className: 'm-0 text-[13px] text-muted leading-relaxed flex-1 min-w-0' }, 'Deletes the route, token and stored credentials.'),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-outline btn-error shrink-0',
            onClick: () =>
              openDeleteDialog({
                service: { name: savedName },
                onDeleted: () => {
                  closeServiceDrawer({ skipConfirm: true });
                  handlers.onDeleted?.(savedName);
                },
              }),
          },
          `Delete ${savedName}…`,
        ),
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
        testResult.className = 'text-sm m-0 min-h-5 text-warn';
        testResult.textContent = res.warning || `Reached the service, but it rejected the credential (HTTP ${res.status})`;
      } else if (res.ok) {
        testResult.className = 'text-sm m-0 min-h-5 text-live';
        testResult.textContent = `Reachable — HTTP ${res.status}`;
      } else {
        testResult.className = 'text-sm m-0 min-h-5 text-danger-text';
        testResult.textContent = res.error || 'Unreachable';
      }
    } catch (e) {
      testResult.className = 'text-sm m-0 min-h-5 text-danger-text';
      testResult.textContent = e.message;
    }
  }

  async function save() {
    errBox.textContent = '';
    const body = {
      name: slugify(draft.name) || draft.name,
      url: draft.url,
      enabled: draft.enabled,
      access: draft.access,
      openPaths: draft.openPaths
        .filter((p) => (p.path || '').trim())
        .map((p) => ({
          match: p.match === 'regex' ? 'regex' : 'prefix',
          path: p.path.trim(),
        })),
      auth: authToPayload(draft.auth),
    };
    try {
      const creating = !savedName;
      const prevName = savedName;
      let saved;
      if (savedName) {
        saved = await api.updateService(savedName, body);
      } else {
        saved = await api.createService(body);
      }
      const renamed = !!(prevName && saved.name !== prevName);
      savedName = saved.name;
      token = saved.token || token;
      draft.name = saved.name;
      nameInput.value = saved.name;
      titleEl.textContent = saved.name;
      baseline = snapshot();
      markDirty();
      renderToken();
      renderDelete();
      updateHints();
      isEdit = true;
      origUrl = saved.url || draft.url;
      prevBtn.disabled = false;
      nextBtn.disabled = false;
      panel.setAttribute('aria-label', `Edit ${savedName}`);
      handlers.onSaved?.(saved, { created: creating, renamed });
      showToast(creating ? 'Service created' : 'Saved');
      setState({ drawer: { mode: 'edit', name: savedName } });
    } catch (e) {
      errBox.textContent = e.errors ? Object.values(e.errors).join(' · ') : e.message;
    }
  }

  function loadService(svc) {
    service = svc;
    isEdit = true;
    savedName = svc.name;
    token = svc.token || '';
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
    nameInput.value = draft.name;
    urlInput.value = draft.url;
    liveToggle.checked = draft.enabled;
    titleEl.textContent = svc.name;
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    panel.setAttribute('aria-label', `Edit ${svc.name}`);
    baseline = snapshot();
    errBox.textContent = '';
    testResult.textContent = '';
    renderAuth();
    renderAccess();
    renderPaths();
    renderToken();
    renderDelete();
    updateHints();
    paintChrome();
  }

  function paintChrome() {
    const n = dirtyCount();
    dirtyLabel.textContent = n ? `● ${n} unsaved change${n === 1 ? '' : 's'}` : '';
    dirtyLabel.className = n ? 'drawer-dirty-label is-dirty' : 'drawer-dirty-label';
  }

  const mod = isMac() ? '⌘' : 'Ctrl';

  const footer = h(
    'div',
    { className: 'drawer-footer' },
    dirtyLabel,
    h(
      'div',
      { className: 'flex items-center gap-2 ml-auto' },
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-ghost btn-sm',
          onClick: () => {
            if (!isDirty() || confirm('Discard unsaved changes?')) {
              if (savedName) {
                const svc = state.services.find((s) => s.name === savedName);
                if (svc) loadService(svc);
                else closeServiceDrawer({ skipConfirm: true });
              } else {
                closeServiceDrawer({ skipConfirm: true });
                handlers.onClose?.();
              }
            }
          },
        },
        'Discard',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm gap-1.5',
          onClick: () => save(),
        },
        'Save',
        h('kbd', { className: 'kbd-hint kbd-hint-on-primary' }, `${mod}S`),
      ),
    ),
  );

  bodyHost.append(
    h(
      'div',
      { className: 'drawer-section flex flex-col gap-3' },
      h('span', { className: 'label-caps' }, 'Service'),
      h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('label', { className: 'label text-cream-dim' }, 'Name'),
        nameInput,
        renameHint,
      ),
      h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('label', { className: 'label text-cream-dim' }, 'Upstream URL'),
        h(
          'div',
          { className: 'flex gap-2 items-center' },
          urlInput,
          h('button', { type: 'button', className: 'btn btn-sm shrink-0', onClick: runTest }, 'Test'),
        ),
        wasUrl,
        testResult,
      ),
    ),
    authHost,
    accessHost,
    tokenHost,
    pathsHost,
    deleteHost,
    errBox,
  );

  renderAuth();
  renderAccess();
  renderPaths();
  renderToken();
  renderDelete();
  updateHints();
  paintChrome();

  const panel = h(
    'aside',
    {
      className: 'drawer-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': isEdit ? `Edit ${service.name}` : 'Add service',
    },
    h(
      'div',
      { className: 'drawer-header' },
      h(
        'div',
        { className: 'flex items-center gap-2.5 min-w-0 flex-1' },
        titleEl,
        h('span', { className: 'text-xs text-muted shrink-0' }, 'Live'),
        liveToggle,
      ),
      h(
        'div',
        { className: 'flex items-center gap-1 shrink-0' },
        prevBtn,
        nextBtn,
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-square btn-sm',
            'aria-label': 'Close',
            onClick: () => {
              if (closeServiceDrawer()) handlers.onClose?.();
            },
          },
          Icon('close', { size: 16 }),
        ),
      ),
    ),
    bodyHost,
    footer,
  );

  const el = h(
    'div',
    {
      className: 'drawer-root',
      onClick: (e) => {
        if (e.target === el) {
          if (closeServiceDrawer()) handlers.onClose?.();
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
    set mode(v) {
      /* noop setter for create→edit */
    },
    get savedName() {
      return savedName;
    },
    draft,
    isDirty,
    save,
    loadService,
  };
}
