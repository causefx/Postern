import { api } from './api.js';
import { state, setState, subscribe } from './state.js';
import { h, clear } from './lib/h.js';
import { AppHeader } from './components/layout/AppHeader.js';
import { HttpsBanner } from './components/layout/HttpsBanner.js';
import { PageHeader } from './components/layout/PageHeader.js';
import { ServiceToolbar } from './components/services/ServiceToolbar.js';
import { ServiceList } from './components/services/ServiceList.js';
import { EmptyState } from './components/services/EmptyState.js';
import { FlowDiagram } from './components/services/FlowDiagram.js';
import { mountToast, showToast } from './components/common/Toast.js';
import { openServiceForm } from './components/form/ServiceFormModal.js';
import { openServiceCreated } from './components/dialogs/ServiceCreatedModal.js';
import { openRotateDialog } from './components/dialogs/RotateTokenDialog.js';
import { openDeleteDialog } from './components/dialogs/DeleteServiceDialog.js';

const root = document.getElementById('app');
mountToast(document.body);

const handlers = {
  onEdit: (service) =>
    openServiceForm({
      service,
      onSaved: async () => {
        await reload();
        showToast('Service saved');
      },
    }),
  onRotate: (service) =>
    openRotateDialog({
      service,
      onRotated: async () => {
        await reload();
      },
    }),
  onDelete: (service) =>
    openDeleteDialog({
      service,
      onDeleted: async () => {
        await reload();
        showToast(`${service.name} deleted`);
      },
    }),
};

function openAdd(trigger) {
  openServiceForm({
    trigger,
    onSaved: async (saved, { created }) => {
      await reload();
      if (created) {
        openServiceCreated({
          service: saved,
          onAddAnother: () => openAdd(),
          onDone: () => {},
        });
      } else {
        showToast('Service saved');
      }
    },
  });
}

function render() {
  clear(root);
  root.append(AppHeader());

  const main = h('main', {
    className: 'max-w-[1200px] mx-auto px-6 pt-8 pb-16 flex flex-col gap-6',
  });

  const banner = HttpsBanner();
  if (!state.services.length) {
    if (banner) main.append(banner);
    main.append(EmptyState({ onAdd: () => openAdd() }));
  } else {
    main.append(PageHeader({ onAdd: () => openAdd() }));
    if (banner) main.append(banner);
    main.append(ServiceToolbar(), ServiceList({ handlers }), FlowDiagram());
  }
  root.append(main);
}

async function reload() {
  const services = await api.listServices();
  setState({ services });
}

async function boot() {
  try {
    const meta = await api.meta();
    setState({ meta });
  } catch {
    /* meta is optional */
  }
  subscribe(render);
  await reload();
}

boot().catch((err) => {
  root.replaceChildren(h('p', { className: 'p-8 text-danger-text' }, err.message));
});
