import { api } from './api.js';
import { absorbServices } from './lib/liveList.js';
import {
  state,
  setState,
  subscribe,
  filteredServices,
  focusedService,
  setFocusIndex,
  toggleSelect,
  syncListState,
} from './state.js';
import { h, clear } from './lib/h.js';
import { DashboardHeader } from './components/layout/DashboardHeader.js';
import { KeyboardHints } from './components/layout/KeyboardHints.js';
import { FilterBar } from './components/services/FilterBar.js';
import { ServiceList } from './components/services/ServiceList.js';
import { MobileServiceList } from './components/services/MobileServiceList.js';
import { BulkActionBar } from './components/services/BulkActionBar.js';
import { EmptyState } from './components/services/EmptyState.js';
import { CommandPalette } from './components/command/CommandPalette.js';
import { mountToast, toast } from './components/common/Toast.js';
import { openUpdateDialog } from './components/dialogs/UpdateDialog.js';
import {
  openServiceDrawer,
  closeServiceDrawer,
  isDrawerOpen,
  navigateDrawer,
  requestDrawerSave,
  getDrawerName,
} from './components/drawer/ServiceDrawer.js';
import { copyServiceToken, toggleServiceEnabled } from './lib/serviceActions.js';
import { reveal } from './lib/motion.js';
import {
  openSettings,
  closeSettings,
  backOrCloseSettings,
  isSettingsOpen,
  requestSettingsSave,
  showSettingsTab,
} from './components/settings/SettingsDrawer.js';

const root = document.getElementById('app');
mountToast(document.body);

const drawerHandlers = {
  onSaved: async (saved) => {
    await reload();
    const items = filteredServices();
    const idx = items.findIndex((s) => s.name === saved.name);
    if (idx >= 0) setState({ focusIndex: idx });
  },
  onDeleted: async () => {
    await reload();
    toast.success('Service deleted');
  },
  onClose: () => {},
  onNavigate: async (delta) => {
    const items = filteredServices();
    if (!items.length) return;
    const curName = getDrawerName();
    let idx = items.findIndex((s) => s.name === curName);
    if (idx < 0) idx = state.focusIndex;
    const next = items[((idx + delta) % items.length + items.length) % items.length];
    if (await navigateDrawer(next)) setState({ focusIndex: items.indexOf(next) });
  },
};

// With a tab (from the command palette) an open drawer switches to it; without one the header
// button toggles the drawer.
async function openSettingsDrawer(tab) {
  if (isSettingsOpen()) {
    if (tab) {
      setState({ commandOpen: false });
      showSettingsTab(tab);
    } else {
      closeSettings();
    }
    return;
  }
  if (isDrawerOpen() && !(await closeServiceDrawer())) return;
  setState({ commandOpen: false });
  openSettings({ tab });
}

function openUpdates() {
  setState({ commandOpen: false });
  openUpdateDialog();
}

/** Pull the server's cached update status. It never makes the server call GitHub. */
async function loadUpdate() {
  try {
    const update = await api.update();
    // Only repaint when something the UI shows has changed.
    const prev = state.update;
    if (!prev || prev.available !== update.available || prev.latest !== update.latest || prev.enabled !== update.enabled) {
      setState({ update });
    }
  } catch {
    /* the pill just stays as it was */
  }
}

function openCreate() {
  if (isSettingsOpen() && !closeSettings()) return;
  setState({ commandOpen: false });
  openServiceDrawer({ mode: 'create', handlers: drawerHandlers });
}

function openEdit(service) {
  if (!service) return;
  if (isSettingsOpen() && !closeSettings()) return;
  setState({ commandOpen: false });
  const items = filteredServices();
  const idx = items.findIndex((s) => s.name === service.name);
  if (idx >= 0) setState({ focusIndex: idx });
  openServiceDrawer({ mode: 'edit', service, handlers: drawerHandlers });
}

function typingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest?.('.cmd-overlay')) return true;
  return false;
}

function onKeydown(e) {
  if (state.commandOpen) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    setState({ commandOpen: true });
    return;
  }

  if (isSettingsOpen()) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      requestSettingsSave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      backOrCloseSettings();
      return;
    }
    return;
  }

  if (isDrawerOpen()) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      requestDrawerSave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      void closeServiceDrawer();
      return;
    }
    if (!typingTarget(e.target) && (e.key === 'j' || e.key === 'J' || e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      void drawerHandlers.onNavigate(e.key.toLowerCase() === 'j' ? 1 : -1);
      return;
    }
    return;
  }

  if (typingTarget(e.target)) return;

  const key = e.key;
  if (key === 'n' || key === 'N') {
    e.preventDefault();
    openCreate();
    return;
  }
  if (key === ',') {
    e.preventDefault();
    void openSettingsDrawer();
    return;
  }

  const items = filteredServices();
  if (!items.length) return;

  if (key === 'j' || key === 'J') {
    e.preventDefault();
    setFocusIndex(state.focusIndex < 0 ? 0 : state.focusIndex + 1);
    return;
  }
  if (key === 'k' || key === 'K') {
    e.preventDefault();
    setFocusIndex(state.focusIndex < 0 ? 0 : state.focusIndex - 1);
    return;
  }

  const svc = focusedService();
  if (!svc) {
    if (['x', 'X', ' ', 'c', 'C', 'Enter'].includes(key)) setFocusIndex(0);
    return;
  }

  if (key === 'x' || key === 'X') {
    e.preventDefault();
    toggleSelect(svc.name);
    return;
  }
  if (key === ' ') {
    e.preventDefault();
    toggleServiceEnabled(svc);
    return;
  }
  if (key === 'c' || key === 'C') {
    e.preventDefault();
    copyServiceToken(svc);
    return;
  }
  if (key === 'Enter') {
    e.preventDefault();
    openEdit(svc);
  }
}

function render() {
  syncListState();
  clear(root);

  root.append(
    DashboardHeader({
      onAdd: () => openCreate(),
      onOpenCommand: () => setState({ commandOpen: true }),
      onSettings: () => openSettingsDrawer(),
      onUpdate: () => openUpdates(),
    }),
  );

  const main = h('main', { className: 'dash-main flex flex-col gap-4' });

  if (!state.services.length) {
    main.append(EmptyState({ onAdd: () => openCreate() }));
  } else {
    main.append(FilterBar());
    const bulk = BulkActionBar();
    if (bulk) main.append(bulk);
    main.append(
      ServiceList({ onOpen: openEdit }),
      MobileServiceList({ onOpen: openEdit, onAdd: () => openCreate() }),
    );
  }
  main.append(KeyboardHints({ drawerOpen: isDrawerOpen() }));
  root.append(main);

  const palette = CommandPalette({
    onAdd: () => openCreate(),
    onReload: () => reload(),
    onEdit: openEdit,
    onSettings: (tab) => openSettingsDrawer(tab),
    onUpdate: () => openUpdates(),
  });
  if (palette) root.append(palette);
  playEntrances(main);
}

let booted = false;

/**
 * The page is rebuilt on every state change, so entrances are remembered by name (see reveal):
 * the header and filter bar come in once, a service row comes in the first time it is on screen.
 */
function playEntrances(main) {
  const lead = booted ? 0 : 0.06;
  reveal([{ key: 'shell:header', el: root.querySelector('.dash-header') }], { y: -8, duration: 0.3 });
  if (main.firstElementChild) {
    reveal([{ key: state.services.length ? 'shell:filter' : 'shell:empty', el: main.firstElementChild }], { delay: lead, y: 8 });
  }
  const rows = [...root.querySelectorAll('tr.svc-tr[data-name], .mobile-row[data-name]')].map((el) => ({
    key: `row:${el.dataset.name}`,
    el,
  }));
  reveal(rows, { delay: booted ? 0 : 0.12, step: 0.03, y: 8 });
  booted = true;
}

async function reload() {
  const services = await api.listServices();
  setState({ services });
}

let liveBusy = false;

async function refreshLive() {
  if (liveBusy || document.hidden) return;
  liveBusy = true;
  try {
    const services = await api.listServices();
    if (!absorbServices(services)) setState({ services });
  } catch {
    /* keep the list already on screen */
  } finally {
    liveBusy = false;
  }
}

async function boot() {
  try {
    const meta = await api.meta();
    setState({ meta });
  } catch {
    /* meta optional */
  }
  document.addEventListener('keydown', onKeydown);
  subscribe(render);
  await reload();
  loadUpdate();
  // The server checks GitHub about once a day; this only picks up its latest answer.
  window.setInterval(loadUpdate, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshLive();
  });
  window.setInterval(refreshLive, 2000);
  if (new URLSearchParams(location.search).get('settings') === '1') {
    history.replaceState(null, '', location.pathname);
    openSettings();
  }
}

boot().catch((err) => {
  root.replaceChildren(h('p', { className: 'p-8 text-danger' }, err.message));
});
