import { api } from '../api.js';
import { state, setState, clearSelection } from '../state.js';
import { copyValue } from './clipboard.js';
import { showToast } from '../components/common/Toast.js';

export async function copyServiceToken(service) {
  if (!service?.token) {
    showToast('No token', 'error');
    return;
  }
  try {
    await copyValue(service.token);
  } catch {
    /* toast already shown */
  }
}

export async function toggleServiceEnabled(service) {
  if (!service) return;
  const next = !service.enabled;
  const prev = state.services.map((s) => (s.name === service.name ? { ...s, enabled: next } : s));
  setState({ services: prev });
  try {
    const updated = await api.setEnabled(service.name, next);
    setState({
      services: state.services.map((s) => (s.name === service.name ? updated : s)),
    });
  } catch (err) {
    setState({
      services: state.services.map((s) => (s.name === service.name ? { ...s, enabled: !next } : s)),
    });
    showToast(err.message, 'error');
  }
}

export async function setManyEnabled(names, enabled) {
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    try {
      const updated = await api.setEnabled(name, enabled);
      setState({
        services: state.services.map((s) => (s.name === name ? updated : s)),
      });
      ok++;
    } catch {
      fail++;
    }
  }
  if (fail) showToast(`Updated ${ok}, ${fail} failed`, 'error');
  else showToast(enabled ? `Turned on ${ok}` : `Turned off ${ok}`);
}

export async function rotateMany(names) {
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    try {
      const updated = await api.rotateToken(name);
      setState({
        services: state.services.map((s) => (s.name === name ? updated : s)),
      });
      ok++;
    } catch {
      fail++;
    }
  }
  if (fail) showToast(`Rotated ${ok}, ${fail} failed`, 'error');
  else showToast(`Rotated ${ok} token${ok === 1 ? '' : 's'}`);
}

export async function deleteMany(names) {
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    try {
      await api.deleteService(name);
      setState({ services: state.services.filter((s) => s.name !== name) });
      ok++;
    } catch {
      fail++;
    }
  }
  clearSelection();
  if (fail) showToast(`Deleted ${ok}, ${fail} failed`, 'error');
  else showToast(`Deleted ${ok}`);
}
