export function auditServices(entries) {
  const names = new Set();
  for (const ev of entries || []) {
    if (ev.service) names.add(ev.service);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function auditHeadline(ev) {
  const name = ev.service || '';
  switch (ev.action) {
    case 'update':
      return ev.from ? { before: `Renamed ${ev.from} to `, name } : { before: 'Updated ', name };
    case 'rotate':
      return { before: `Rotated the ${ev.token || 'caller'} token for `, name };
    case 'token_add':
      return { before: `Added the ${ev.token || 'caller'} token for `, name };
    case 'token_revoke':
      return { before: `Revoked the ${ev.token || 'caller'} token for `, name };
    case 'create':
      return { before: 'Created ', name };
    case 'delete':
      return { before: 'Deleted ', name };
    case 'enable':
      return { before: ev.enabled ? 'Turned on ' : 'Turned off ', name };
    case 'duplicate':
      return ev.from ? { before: `Duplicated ${ev.from} as `, name } : { before: 'Duplicated ', name };
    case 'settings':
      return { before: 'Changed settings', name: '' };
    default:
      return { before: ev.action ? `${ev.action} ` : 'Changed ', name };
  }
}

export function auditDetail(ev) {
  if (ev.action === 'settings') {
    const bits = [];
    if (ev.rate != null) bits.push(ev.rate === 0 ? 'rate off' : `rate ${ev.rate}`);
    if (ev.activity != null) bits.push(`activity ${ev.activity}`);
    if (ev.audit != null) bits.push(`audit ${ev.audit}`);
    if (ev.passwordLogin != null) bits.push(ev.passwordLogin ? 'password on' : 'password off');
    return bits.join(' · ');
  }
  return ev.url ? `url → ${ev.url}` : '';
}

export function auditIcon(action) {
  switch (action) {
    case 'update':
      return 'pencil';
    case 'rotate':
      return 'rotate';
    case 'delete':
    case 'token_revoke':
      return 'trash';
    case 'create':
    case 'token_add':
      return 'plus';
    case 'duplicate':
      return 'copy';
    case 'enable':
      return 'power';
    case 'settings':
      return 'gear';
    default:
      return 'chevron';
  }
}

export function auditWhen(iso, now = new Date()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return { day: 'Earlier', meta: '' };
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((start(now) - start(t)) / 86400000);
  let day = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (dayDiff === 0) day = 'Today';
  else if (dayDiff === 1) day = 'Yesterday';
  const clock = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return { day, meta: `${agoLabel(now - t)} · ${clock}` };
}

function agoLabel(ms) {
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day ago`;
}
