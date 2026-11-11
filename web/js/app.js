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
import { HttpsBanner } from './components/layout/HttpsBanner.js';
import { KeyboardHints } from './components/layout/KeyboardHints.js';
import { FilterBar } from './components/services/FilterBar.js';
import { ServiceList } from './components/services/ServiceList.js';
import { MobileServiceList } from './components/services/MobileServiceList.js';
import { BulkActionBar } from './components/services/BulkActionBar.js';
import { EmptyState } from './components/services/EmptyState.js';
import { CommandPalette } from './components/command/CommandPalette.js';
import { mountToast, showToast } from './components/common/Toast.js';
import {
  openServiceDrawer,
  closeServiceDrawer,
  isDrawerOpen,
  navigateDrawer,
  requestDrawerSave,
  getDrawerName,
} from './components/drawer/ServiceDrawer.js';
import { copyServiceToken, toggleServiceEnabled } from './lib/serviceActions.js';
import {
  openSettings,
  closeSettings,
  isSettingsOpen,
  requestSettingsSave,
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
    showToast('Service deleted');
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

async function openSettingsDrawer() {
  if (isSettingsOpen()) {
    closeSettings();
    return;
  }
  if (isDrawerOpen() && !(await closeServiceDrawer())) return;
  setState({ commandOpen: false });
  openSettings();
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
      closeSettings();
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
    }),
  );

  const main = h('main', { className: 'dash-main flex flex-col gap-4' });
  const banner = HttpsBanner();

  if (!state.services.length) {
    if (banner) main.append(banner);
    main.append(EmptyState({ onAdd: () => openCreate() }));
  } else {
    if (banner) main.append(banner);
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
    onSettings: () => openSettingsDrawer(),
  });
  if (palette) root.append(palette);
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshLive();
  });
  window.setInterval(refreshLive, 2000);
  if (new URLSearchParams(location.search).get('settings') === '1') {
    history.replaceState(null, '', location.pathname);
    openSettings();
  }
  if (filteredServices().length && state.focusIndex < 0) {
    setState({ focusIndex: 0 });
  }
}

boot().catch((err) => {
  root.replaceChildren(h('p', { className: 'p-8 text-danger-text' }, err.message));
});
