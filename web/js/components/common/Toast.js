import { h } from '../../lib/h.js';
import { Icon } from './Icon.js';

/**
 * Toasts: small raised cards at the bottom-left of the screen (full width on a phone). Colour is
 * only on the status icon. A thin line along the bottom shows how long is left, and hovering or
 * focusing a toast, or leaving the tab, pauses it.
 *
 *   toast.quick('Token copied')                                   one line, 2 s
 *   toast.success('Settings saved', { detail: 'Logged to admin log' })   4 s
 *   toast.success('Token paused', { detail: '…', undo: () => … })        8 s, with an Undo button
 *   toast.warning('Saved — restart needed', { detail: '…' })             8 s
 *   toast.error("Couldn't save settings", { detail: '…', retry: () => … }) stays until closed
 *   const t = toast.progress('Importing 6 services…', { detail: 'Applying all at once' });
 *   t.success('Imported 6 services');   // the same card turns into the result
 *
 * Titles are past tense and short; the detail line says what it means. Newest is at the bottom, at
 * most three show, and the oldest is pushed out. `showToast(message, type)` is the old call.
 */

const MAX_VISIBLE = 3;
const EXIT_MS = 160;
const DURATION = { quick: 2000, success: 4000, warning: 8000, error: 0, progress: 0 };
const UNDO_MS = 8000;
const ICONS = { success: 'check', quick: 'copy', warning: 'alert', error: 'close' };

let root = null;
/** Toasts on screen, oldest first. */
const live = new Set();

export function mountToast(parent = document.body) {
  if (root?.isConnected) return;
  root = h('div', { className: 'tst-stack', role: 'region', 'aria-label': 'Notifications' });
  parent.append(root);
}

function ensureRoot() {
  if (!root?.isConnected) mountToast(document.body);
}

/** Opens a toast and returns a handle: update, success, warning, error, quick, progress, dismiss. */
export function toast(opts) {
  ensureRoot();
  const t = {
    opts: normalize(opts),
    el: h('div', { className: 'tst' }),
    timer: 0,
    holds: 0,
    startedAt: 0,
    remaining: 0,
    gone: false,
  };
  t.life = h('span', { className: 'tst-life', 'aria-hidden': 'true' });

  // The same key replaces the toast already showing, so pressing a button twice does not stack.
  for (const other of [...live]) {
    if (other.opts.key === t.opts.key && other.opts.kind !== 'progress') remove(other);
  }
  live.add(t);
  while (live.size > MAX_VISIBLE) remove(live.values().next().value, { fast: true });

  t.el.addEventListener('mouseenter', () => hold(t, 1));
  t.el.addEventListener('mouseleave', () => hold(t, -1));
  t.el.addEventListener('focusin', () => hold(t, 1));
  t.el.addEventListener('focusout', () => hold(t, -1));

  paint(t);
  root.append(t.el);
  arm(t);

  const handle = {
    el: t.el,
    update: (next) => {
      if (t.gone) return handle;
      const merged = { ...t.opts, ...next };
      // A new kind brings its own icon unless the caller names one.
      if (next.kind && next.kind !== t.opts.kind && !('icon' in next)) delete merged.icon;
      t.opts = normalize(merged);
      paint(t);
      arm(t);
      return handle;
    },
    dismiss: () => remove(t),
  };
  for (const kind of ['quick', 'success', 'warning', 'error', 'progress']) {
    handle[kind] = (title, more = {}) => handle.update({ kind, title, detail: '', action: null, duration: undefined, ...more });
  }
  return handle;
}

toast.quick = (title, more) => toast({ kind: 'quick', title, ...more });
toast.success = (title, more) => toast({ kind: 'success', title, ...more });
toast.warning = (title, more) => toast({ kind: 'warning', title, ...more });
toast.error = (title, more) => toast({ kind: 'error', title, ...more });
toast.progress = (title, more) => toast({ kind: 'progress', title, ...more });

/** The old call: a message, plain or an error. New code should use the toast.* calls above. */
export function showToast(message, type = 'success') {
  if (type === 'error') return toast.error(message);
  return toast.success(message);
}

// ---- internals ----

/** Fills in defaults: the action from undo/retry, the timing from the kind. */
function normalize(o) {
  const kind = ['quick', 'success', 'warning', 'error', 'progress'].includes(o.kind) ? o.kind : 'success';
  let action = o.action || null;
  if (!action && o.undo) action = { label: o.undoLabel || 'Undo', onClick: o.undo };
  if (!action && o.retry) action = { label: o.retryLabel || 'Retry', onClick: o.retry };
  let duration = o.duration;
  if (duration === undefined) duration = action && kind === 'success' ? UNDO_MS : DURATION[kind];
  return {
    kind,
    title: String(o.title ?? ''),
    detail: kind === 'quick' ? '' : String(o.detail || ''),
    action,
    duration,
    key: o.key ?? `${kind}:${o.title}`,
    icon: o.icon || ICONS[kind],
  };
}

function paint(t) {
  const { kind, title, detail, action, icon } = t.opts;
  t.el.className = `tst is-${kind}`;
  t.el.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');
  const mark =
    kind === 'progress'
      ? h('span', { className: 'tst-spinner', 'aria-hidden': 'true' })
      : Icon(icon, { size: kind === 'error' ? 13 : 14 });
  const children = [
    h('span', { className: 'tst-icon' }, mark),
    h('div', { className: 'tst-text' }, h('p', { className: 'tst-title' }, title), detail ? h('p', { className: 'tst-detail' }, detail) : null),
  ];
  if (action) {
    children.push(
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-outline btn-xs tst-action',
          onClick: () => {
            try {
              action.onClick?.();
            } finally {
              remove(t);
            }
          },
        },
        action.label,
      ),
    );
  }
  children.push(
    h('button', { type: 'button', className: 'tst-close', 'aria-label': 'Dismiss', onClick: () => remove(t) }, Icon('close', { size: 14 })),
    t.life,
  );
  t.el.replaceChildren(...children);
}

/** Starts (or restarts) the countdown. A duration of 0 stays until closed. */
function arm(t) {
  clearTimeout(t.timer);
  const ms = t.opts.duration;
  t.life.hidden = !ms;
  t.el.classList.remove('is-paused');
  // Restart the shrinking line from full.
  t.life.style.animation = 'none';
  void t.life.offsetWidth;
  t.life.style.animation = '';
  if (!ms) return;
  t.life.style.setProperty('--tst-ms', `${ms}ms`);
  t.remaining = ms;
  t.startedAt = performance.now();
  if (t.holds === 0) t.timer = setTimeout(() => remove(t), ms);
  else t.el.classList.add('is-paused');
}

/** +1 when the pointer, focus or a hidden tab holds the toast, -1 when it lets go. */
function hold(t, delta) {
  const before = t.holds;
  t.holds = Math.max(0, t.holds + delta);
  const ms = t.opts.duration;
  if (!ms || t.gone) return;
  if (before === 0 && t.holds > 0) {
    clearTimeout(t.timer);
    t.remaining = Math.max(0, t.remaining - (performance.now() - t.startedAt));
    t.el.classList.add('is-paused');
  } else if (before > 0 && t.holds === 0) {
    t.startedAt = performance.now();
    // Give a toast that was nearly over a moment to be read.
    t.remaining = Math.max(t.remaining, 800);
    t.timer = setTimeout(() => remove(t), t.remaining);
    t.el.classList.remove('is-paused');
  }
}

function remove(t, { fast = false } = {}) {
  if (!t || t.gone) return;
  t.gone = true;
  clearTimeout(t.timer);
  live.delete(t);
  if (fast) {
    t.el.remove();
    return;
  }
  t.el.classList.add('is-leaving');
  setTimeout(() => t.el.remove(), EXIT_MS);
}

// A hidden tab holds every toast, so nothing expires while nobody can see it.
document.addEventListener('visibilitychange', () => {
  for (const t of live) hold(t, document.hidden ? 1 : -1);
});
