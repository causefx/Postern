import { state } from '../state.js';
import { recentLabel, recentTitle } from './serviceDisplay.js';

const recentKeys = ['requests', 'lastStatus', 'lastSeen', 'lastWho'];

function shape(service) {
  return [service.name, service.enabled ? 1 : 0, service.url || '', service.access || '', JSON.stringify(service.auth || {})].join('\u0001');
}

/** Copy new recent fields onto the current list when nothing else changed. */
export function absorbServices(next) {
  const cur = state.services;
  if (cur.length !== next.length) return false;
  const incoming = new Map(next.map((s) => [s.name, s]));
  for (const service of cur) {
    const fresh = incoming.get(service.name);
    if (!fresh || shape(service) !== shape(fresh)) return false;
  }
  for (const service of cur) {
    const fresh = incoming.get(service.name);
    let touched = false;
    for (const key of recentKeys) {
      if (service[key] !== fresh[key]) {
        service[key] = fresh[key];
        touched = true;
      }
    }
    if (touched) paintRecent(service);
  }
  return true;
}

/** Drop one service's recent summary on the list immediately. */
export function blankServiceRecent(name) {
  const service = state.services.find((s) => s.name === name);
  if (!service) return;
  service.requests = 0;
  delete service.lastStatus;
  delete service.lastSeen;
  delete service.lastWho;
  paintRecent(service);
}

function paintRecent(service) {
  const label = recentLabel(service);
  const title = recentTitle(service);
  const sel = `[data-recent="${CSS.escape(service.name)}"]`;
  document.querySelectorAll(sel).forEach((el) => {
    if (el.dataset.recentInline === '1') {
      el.textContent = label ? ` · ${label}` : '';
      return;
    }
    el.textContent = label || '—';
    el.title = title;
  });
}
