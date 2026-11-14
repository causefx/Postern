// Helpers for the export and import screens in Settings. Nothing here touches the DOM except
// downloadText, so the rest can be tested on its own.

const pad = (n) => String(n).padStart(2, '0');

/** postern-config.redacted.json, or postern-backup-2026-11-13.json for a full backup. */
export function exportFilename(mode, now = new Date()) {
  if (mode !== 'full') return 'postern-config.redacted.json';
  return `postern-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Saves text as a file through a temporary link. */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1024 -> "1 KB", 1048576 -> "1 MB". */
export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${n} B`;
}

/** "Nov 12", or "Nov 12, 2025" when it is not this year. Empty when the time is missing or bad. */
export function shortDate(iso, now = new Date()) {
  const t = new Date(iso);
  if (!iso || Number.isNaN(t.getTime())) return '';
  return t.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** One line about a file the person picked: "Redacted · exported Nov 12 · 6 services". */
export function fileSummary({ redacted, exported, services }, now = new Date()) {
  const parts = [redacted ? 'Redacted' : 'Full backup'];
  const date = shortDate(exported, now);
  if (date) parts.push(`exported ${date}`);
  parts.push(`${services} ${services === 1 ? 'service' : 'services'}`);
  return parts.join(' · ');
}

const RANK = { overwrite: 0, skip: 0, create: 1, error: 2 };

/** Existing services first, then new ones, then problems. Order inside each group is the file's. */
export function sortResults(results) {
  return (results || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (RANK[a.r.action] ?? 3) - (RANK[b.r.action] ?? 3) || a.i - b.i)
    .map((x) => x.r);
}

const ACTION_LABEL = { create: 'Create', overwrite: 'Overwrite', skip: 'Skip', error: 'Error' };

/** Short label for the right of a row: "Create", "Skip · exists". */
export function resultLabel(r) {
  const base = ACTION_LABEL[r.action] || r.action;
  return r.action === 'skip' && r.reason ? `${base} · ${r.reason}` : base;
}

/** The problems of one row as [{ key, message }], in field order. */
export function resultErrors(r) {
  return Object.entries(r.errors || {})
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, message]) => ({ key, message }));
}

/** Count chips such as "2 create". Zero counts are left out. */
export function countChips(counts) {
  const c = counts || {};
  return ['create', 'overwrite', 'skip', 'error']
    .filter((k) => c[k] > 0)
    .map((k) => ({ kind: k, text: `${c[k]} ${k}` }));
}

/** How many services an import would write. */
export function importable(counts) {
  const c = counts || {};
  return (c.create || 0) + (c.overwrite || 0);
}

export function importButtonLabel(counts) {
  const n = importable(counts);
  return `Import ${n} ${n === 1 ? 'service' : 'services'}`;
}

/** The sentence under the failed list: how many problems, and what that means. */
export function errorSummary(counts) {
  const n = (counts && counts.error) || 0;
  return `Fix ${n} ${n === 1 ? 'error' : 'errors'} in the file to import. Nothing is applied unless every service passes.`;
}
