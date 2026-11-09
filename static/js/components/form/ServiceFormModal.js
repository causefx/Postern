import { h } from '../../lib/h.js';
import { Modal, openModal, closeModal } from '../common/Modal.js';
import { Icon } from '../common/Icon.js';
import { slugify } from '../../lib/slug.js';
import { authPreview, secureTxt } from '../../lib/authPreview.js';
import { authFromView, authToPayload, emptyAuth, isAuthNone } from '../../lib/authPresets.js';
import { AccessModePicker } from './AccessModePicker.js';
import { AuthSlotsEditor } from './AuthSlotsEditor.js';
import { OpenPathsEditor } from './OpenPathsEditor.js';
import { api } from '../../api.js';
import { state } from '../../state.js';

export function openServiceForm({ service = null, trigger, onSaved }) {
  const editing = !!service;
  const form = {
    name: service?.name || '',
    url: service?.url || '',
    enabled: service ? service.enabled : true,
    access: service?.access === 'upstream' ? 'upstream' : 'postern',
    openPaths: (service?.openPaths || []).map((p) => ({
      match: p.match === 'regex' ? 'regex' : 'prefix',
      path: p.path || '',
    })),
    auth: service ? authFromView(service.auth) : emptyAuth(),
  };

  const errBox = h('p', { className: 'text-danger-text text-sm min-h-5 m-0' });
  const testResult = h('p', { className: 'text-sm m-0 min-h-5 flex items-center gap-2' });
  const routeCode = h('code', { className: 'font-mono text-[13px] text-cream-dim break-all' }, routeText(form.name));
  const previewPre = h('pre', { className: 'code-block' }, '');
  const lockLine = h(
    'p',
    { className: 'm-0 text-xs text-muted leading-relaxed flex items-start gap-1.5' },
    Icon('lock', { size: 14, className: 'mt-0.5 shrink-0' }),
    h('span', {}),
  );
  const lockText = lockLine.querySelector('span');
  const authHost = h('div', {});
  const accessHost = h('div', {});
  const openPathsHost = h('div', {});
  const step3Title = h('span', { className: 'm-0 font-display text-[15px] font-semibold' }, step3Heading());

  const nameInput = h('input', {
    className: 'input w-full font-mono text-[15px]',
    value: form.name,
    disabled: editing,
    placeholder: 'sonarr',
    onInput: (e) => {
      form.name = e.target.value;
      routeCode.textContent = routeText(slugify(form.name) || form.name);
      step3Title.textContent = step3Heading();
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

  function step3Heading() {
    const n = slugify(form.name) || form.name || 'this service';
    return `Where does ${n} expect its key?`;
  }

  function renderAuth() {
    authHost.replaceChildren(
      AuthSlotsEditor({
        auth: form.auth,
        editing,
        onChange: () => {
          if (isAuthNone(form.auth) && form.access === 'upstream') {
            form.access = 'postern';
          }
          refreshPreview();
          renderAccess();
        },
      }),
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

  function renderOpenPaths() {
    openPathsHost.replaceChildren(
      OpenPathsEditor({
        paths: form.openPaths,
        onChange: () => {},
      }),
    );
  }

  function refreshPreview() {
    previewPre.textContent = authPreview(form.auth, { url: form.url });
    lockText.textContent = secureTxt(form.auth);
  }

  async function runTest() {
    clear(testResult);
    testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-muted';
    testResult.append(document.createTextNode('Testing…'));
    try {
      const res = await api.testConnection({
        url: form.url,
        auth: authToPayload(form.auth),
        name: editing ? service.name : undefined,
      });
      clear(testResult);
      if (res.authRejected) {
        testResult.className = 'text-sm m-0 min-h-5 flex items-center gap-2 text-warn';
        testResult.append(
          document.createTextNode(res.warning || `Reached the service, but it rejected the credential (HTTP ${res.status})`),
        );
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
      openPaths: form.openPaths
        .filter((p) => (p.path || '').trim())
        .map((p) => ({
          match: p.match === 'regex' ? 'regex' : 'prefix',
          path: p.path.trim(),
        })),
      auth: authToPayload(form.auth),
    };
    try {
      const saved = editing ? await api.updateService(service.name, body) : await api.createService(body);
      closeModal(dlg);
      onSaved?.(saved, { created: !editing });
    } catch (err) {
      errBox.textContent = err.errors ? Object.values(err.errors).join(' · ') : err.message;
    }
  }

  renderAuth();
  renderAccess();
  renderOpenPaths();
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
        h(
          'p',
          { className: 'm-0 text-xs text-muted' },
          'Lowercase letters, numbers and dashes. Other characters are converted for you.',
        ),
      ),
    ),
    section(
      '2',
      'Upstream URL',
      h(
        'div',
        { className: 'flex flex-col gap-2.5' },
        h('div', { className: 'flex gap-2' }, urlInput, h('button', { type: 'button', className: 'btn', onClick: runTest }, 'Test')),
        testResult,
        h(
          'p',
          { className: 'm-0 text-xs text-muted' },
          'Where the service lives on your network. Only Postern needs to reach it.',
        ),
      ),
    ),
    section(
      '3',
      step3Title,
      h(
        'div',
        { className: 'flex flex-col gap-3' },
        h(
          'p',
          { className: 'm-0 text-sm text-muted leading-relaxed' },
          'Switch on each place the service reads a credential from. Most apps need just one; turn on several if the service accepts them in more than one place.',
        ),
        authHost,
        h('span', { className: 'label-caps' }, 'What Postern sends upstream'),
        previewPre,
        lockLine,
      ),
    ),
    section('4', 'How do callers get in?', accessHost),
    section('5', 'Open paths (optional)', openPathsHost),
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
      h(
        'button',
        { type: 'button', className: 'btn btn-primary', onClick: submit },
        editing ? 'Save changes' : 'Create service',
      ),
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
  const titleNode =
    typeof title === 'string' ? h('h3', { className: 'm-0 font-display text-[15px] font-semibold' }, title) : title;
  return h(
    'section',
    { className: 'flex flex-col gap-3' },
    h(
      'div',
      { className: 'flex items-center gap-2.5' },
      h(
        'span',
        {
          className:
            'w-6 h-6 rounded-full bg-slate text-eggshell text-xs font-bold flex items-center justify-center flex-none',
        },
        num,
      ),
      titleNode,
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
