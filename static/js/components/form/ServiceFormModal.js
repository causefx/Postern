import { h } from '../../lib/h.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { Icon } from '../common/Icon.js';
import { slugify } from '../../lib/slug.js';
import { authPreview, secureTxt } from '../../lib/authPreview.js';
import { AuthMethodPicker } from './AuthMethodPicker.js';
import { AuthPresetChips } from './AuthPresetChips.js';
import { AccessModePicker } from './AccessModePicker.js';
import { HeaderAuthFields } from './HeaderAuthFields.js';
import { QueryAuthFields } from './QueryAuthFields.js';
import { BearerAuthFields } from './BearerAuthFields.js';
import { BasicAuthFields } from './BasicAuthFields.js';
import { NoneAuthNote } from './NoneAuthNote.js';
import { api } from '../../api.js';
import { state } from '../../state.js';

export function openServiceForm({ service = null, trigger, onSaved }) {
  const editing = !!service;
  const form = {
    name: service?.name || '',
    url: service?.url || '',
    enabled: service ? service.enabled : true,
    access: service?.access === 'upstream' ? 'upstream' : 'postern',
    auth: {
      type: service?.auth?.type || 'header',
      name: service?.auth?.name || 'X-Api-Key',
      username: service?.auth?.username || '',
      secret: '',
    },
  };

  const errBox = h('p', { className: 'text-danger-text text-sm min-h-5 m-0' });
  const testResult = h('p', { className: 'text-sm m-0 min-h-5 flex items-center gap-2' });
  const routeCode = h('code', { className: 'font-mono text-[13px] text-cream-dim break-all' }, routeText(form.name));
  const previewPre = h('pre', { className: 'code-block' }, '');
  const lockLine = h('p', { className: 'm-0 text-xs text-muted leading-relaxed' }, '');
  const fieldsHost = h('div', {});
  const accessHost = h('div', {});
  const presetHost = h('div', {});
  const methodHost = h('div', {});

  const nameInput = h('input', {
    className: 'input w-full font-mono text-[15px]',
    value: form.name,
    disabled: editing,
    placeholder: 'sonarr',
    onInput: (e) => {
      form.name = e.target.value;
      routeCode.textContent = routeText(slugify(form.name) || form.name);
      refreshPreview();
      renderAccess();
    },
  });

  const urlInput = h('input', {
    className: 'input w-full font-mono text-[15px] flex-1',
    value: form.url,
    placeholder: 'https://sonarr.homefx.dev',
    onInput: (e) => {
      form.url = e.target.value;
      refreshPreview();
    },
  });

  const goLive = h('input', {
    type: 'checkbox',
    className: 'toggle toggle-sm',
    checked: form.enabled,
    onChange: (e) => {
      form.enabled = e.target.checked;
    },
  });

  function patchAuth(partial) {
    Object.assign(form.auth, partial);
    // Don't remount fields here — that steals focus after every keystroke.
    renderPresets();
    renderAccess();
    refreshPreview();
  }

  function setType(type) {
    form.auth.type = type;
    if (type === 'header' && !form.auth.name) form.auth.name = 'X-Api-Key';
    if (type === 'query' && !form.auth.name) form.auth.name = 'apikey';
    if (type === 'none') {
      form.auth.name = form.auth.username = form.auth.secret = '';
      form.access = 'postern';
    }
    renderFields();
    renderPresets();
    renderMethods();
    renderAccess();
    refreshPreview();
  }

  function renderPresets() {
    presetHost.replaceChildren(
      AuthPresetChips({
        auth: form.auth,
        onPick: (p) => {
          form.auth = { ...form.auth, ...p };
          renderFields();
          renderPresets();
          renderMethods();
          renderAccess();
          refreshPreview();
        },
      }),
    );
  }

  function renderMethods() {
    methodHost.replaceChildren(
      AuthMethodPicker({ type: form.auth.type, onChange: setType }),
    );
  }

  function renderAccess() {
    accessHost.replaceChildren(
      AccessModePicker({
        access: form.access,
        auth: form.auth,
        publicBase: routeText(slugify(form.name) || form.name || '<name>'),
        onChange: (id) => {
          form.access = id;
          renderAccess();
        },
      }),
    );
  }

  function renderFields() {
    fieldsHost.replaceChildren();
    const props = { auth: form.auth, editing, onChange: patchAuth };
    const map = {
      header: HeaderAuthFields,
      query: QueryAuthFields,
      bearer: BearerAuthFields,
      basic: BasicAuthFields,
      none: NoneAuthNote,
    };
    fieldsHost.append((map[form.auth.type] || NoneAuthNote)(props));
  }

  function refreshPreview() {
    previewPre.textContent = authPreview(form.auth, { url: form.url });
    lockLine.textContent = secureTxt(form.auth);
  }

  async function runTest() {
    clear(testResult);
    testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-muted';
    testResult.append(document.createTextNode('Testing…'));
    try {
      const res = await api.testConnection({
        url: form.url,
        auth: { ...form.auth },
        name: editing ? service.name : undefined,
      });
      clear(testResult);
      if (res.authRejected) {
        testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-warn';
        testResult.append(document.createTextNode(res.warning || `Reached the service, but it rejected the credential (HTTP ${res.status})`));
      } else if (res.ok) {
        testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-live';
        testResult.append(Icon('check', { size: 16, className: 'text-live' }));
        testResult.append(document.createTextNode(`Reachable from Postern — responded with HTTP ${res.status}`));
      } else {
        testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-danger-text';
        testResult.append(document.createTextNode(res.error || 'Unreachable'));
      }
    } catch (err) {
      clear(testResult);
      testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-danger-text';
      testResult.append(document.createTextNode(err.message));
    }
  }

  async function submit() {
    errBox.textContent = '';
    const body = {
      name: slugify(form.name) || form.name,
      url: form.url,
      enabled: form.enabled,
      access: form.access,
      auth: {
        type: form.auth.type,
        name: form.auth.name || undefined,
        username: form.auth.username || undefined,
        secret: form.auth.secret || undefined,
      },
    };
    try {
      const saved = editing
        ? await api.updateService(service.name, body)
        : await api.createService(body);
      closeModal(dlg);
      onSaved?.(saved, { created: !editing });
    } catch (err) {
      errBox.textContent = err.errors ? Object.values(err.errors).join(' · ') : err.message;
    }
  }

  renderFields();
  renderPresets();
  renderMethods();
  renderAccess();
  refreshPreview();

  const body = h(
    'div',
    { className: 'flex flex-col gap-7' },
    section(
      '1',
      'Name',
      h(
        'div',
        { className: 'flex flex-col gap-2.5' },
        nameInput,
        h(
          'div',
          { className: 'rounded-[10px] border border-line bg-ink-deep px-3.5 py-2.5 flex flex-col gap-1' },
          h('span', { className: 'label-caps' }, 'Public route'),
          routeCode,
        ),
        h('p', { className: 'm-0 text-xs text-muted' }, 'Lowercase letters, numbers and dashes. Other characters are converted for you.'),
      ),
    ),
    section(
      '2',
      'Upstream URL',
      h(
        'div',
        { className: 'flex flex-col gap-2.5' },
        h(
          'div',
          { className: 'flex gap-2' },
          urlInput,
          h('button', { type: 'button', className: 'btn', onClick: runTest }, 'Test'),
        ),
        testResult,
        h('p', { className: 'm-0 text-xs text-muted' }, 'Where the service lives on your network. Only Postern needs to reach it.'),
      ),
    ),
    section(
      '3',
      'How does this service authenticate?',
      h(
        'div',
        { className: 'flex flex-col gap-3' },
        presetHost,
        methodHost,
        fieldsHost,
        h('span', { className: 'label-caps' }, 'What Postern sends upstream'),
        previewPre,
        lockLine,
      ),
    ),
    section('4', 'How do callers get in?', accessHost),
    errBox,
  );

  const footer = h(
    'div',
    { className: 'flex flex-wrap items-center justify-between gap-3 w-full' },
    h('label', { className: 'flex items-center gap-2 text-sm cursor-pointer text-cream-dim' }, goLive, 'Go live right away'),
    h(
      'div',
      { className: 'flex gap-2' },
      h('button', { type: 'button', className: 'btn btn-ghost', onClick: () => closeModal(dlg) }, 'Cancel'),
      h('button', { type: 'button', className: 'btn btn-primary', onClick: submit }, editing ? 'Save changes' : 'Create service'),
    ),
  );

  const dlg = Modal({
    title: editing ? `Edit ${service.name}` : 'Add a service',
    body,
    footer,
    wide: true,
  });
  openModal(dlg, trigger);
  return dlg;
}

function section(num, title, content) {
  return h(
    'section',
    { className: 'flex flex-col gap-3' },
    h(
      'div',
      { className: 'flex items-center gap-2.5' },
      h(
        'span',
        { className: 'w-6 h-6 rounded-full bg-slate text-eggshell text-xs font-bold flex items-center justify-center flex-none' },
        num,
      ),
      h('h3', { className: 'm-0 font-display text-[15px] font-semibold' }, title),
    ),
    content,
  );
}

function routeText(name) {
  const origin = state.meta.publicOrigin || location.origin;
  const slug = slugify(name) || '<name>';
  return `${origin}/p/${slug}/`;
}

function clear(el) {
  el.replaceChildren();
}
