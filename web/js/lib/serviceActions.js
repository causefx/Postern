import { api } from '../api.js';
import { state, setState, clearSelection } from '../state.js';
import { copyValue } from './clipboard.js';
import { toast } from '../components/common/Toast.js';

const count = (n) => `${n} ${n === 1 ? 'service' : 'services'}`;

export async function copyServiceToken(service) {
  if (!service?.token) {
    toast.error('No token to copy', { detail: 'This service has no caller token yet.' });
    return;
  }
  try {
    await copyValue(service.token, 'Token copied');
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
    toast.error("Couldn't change the service", { detail: err.message });
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
  if (fail) toast.warning(`${ok} updated, ${fail} failed`, { detail: 'The others were left as they were.' });
  else toast.success(enabled ? 'Services turned on' : 'Services turned off', { detail: count(ok) });
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
  if (fail) toast.warning(`${ok} rotated, ${fail} failed`, { detail: 'The others kept their old tokens.' });
  else toast.success('Tokens rotated', { detail: `${count(ok)}. The old ones stop working` });
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
  if (fail) toast.warning(`${ok} deleted, ${fail} failed`, { detail: 'The others are still there.' });
  else toast.success('Services deleted', { detail: count(ok) });
}
