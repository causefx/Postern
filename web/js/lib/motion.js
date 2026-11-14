import { animate } from '../vendor/motion-mini.js';

/**
 * Motion for the admin UI, on top of Motion's mini build (Web Animations API, no layout thrash).
 *
 * Two rules keep it calm:
 *  - Nothing plays for people who asked for reduced motion, or while the tab is hidden.
 *  - The dashboard repaints itself from scratch on every state change, so an entrance must be
 *    remembered by name (`first`) or every repaint would replay it.
 */

const EASE_OUT = [0.2, 0.8, 0.2, 1];
const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

export function motionOK() {
  return !reduceQuery?.matches && !document.hidden;
}

const seen = new Set();

/** True the first time a key is asked about, false after. Use it to play an entrance once. */
export function first(key) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** Forget a key, so the next `first(key)` plays again (a row that was deleted and made again). */
export function forget(key) {
  seen.delete(key);
}

function visible(el) {
  return !!el && el.isConnected && el.getClientRects().length > 0;
}

/** Drop the inline styles an animation leaves behind once it is done. */
function settle(controls, el, props) {
  const clean = () => {
    for (const p of props) el.style.removeProperty(p);
  };
  controls.finished.then(clean, clean);
  return controls;
}

/**
 * Fade and lift elements into place, one after the other.
 * Elements that are not on screen (hidden by a breakpoint) are skipped. At most `max` elements
 * animate; the rest are simply there, so a long list does not take seconds to appear.
 * `elapsed` (seconds) starts the animation part-way, for a repaint that replaced the elements
 * while they were still coming in.
 */
export function rise(els, { y = 10, delay = 0, step = 0.035, max = 16, duration = 0.34, elapsed = 0 } = {}) {
  if (!motionOK()) return;
  let i = 0;
  for (const el of [els].flat()) {
    if (!visible(el)) continue;
    if (i >= max) break;
    const wait = delay + i * step;
    i += 1;
    if (elapsed >= wait + duration) continue;
    const controls = animate(
      el,
      { opacity: [0, 1], transform: [`translateY(${y}px)`, 'translateY(0px)'] },
      { duration, delay: wait, ease: EASE_OUT },
    );
    if (elapsed > 0) controls.time = elapsed;
    settle(controls, el, ['opacity', 'transform']);
  }
}

/** key -> { start, index } for entrances that are still playing, so a repaint can carry them on. */
const entering = new Map();

/**
 * Entrance for things the dashboard repaints from scratch. Each item is { key, el }. An item plays
 * once, the first time its key is seen; if the page repaints while it is still coming in, the new
 * element picks the animation up where the old one was.
 */
export function reveal(items, { delay = 0, step = 0.035, max = 16, y = 10, duration = 0.34 } = {}) {
  if (!motionOK()) {
    for (const { key } of items) seen.add(key);
    return;
  }
  const now = performance.now();
  let slot = 0;
  for (const { key, el } of items) {
    if (!visible(el)) continue;
    let rec = entering.get(key);
    if (!rec) {
      if (seen.has(key)) continue;
      seen.add(key);
      rec = { start: now, index: slot, delay };
      entering.set(key, rec);
      window.setTimeout(() => entering.delete(key), (rec.delay + rec.index * step + duration) * 1000 + 120);
    }
    slot += 1;
    if (rec.index >= max) continue;
    rise(el, { y, duration, delay: rec.delay + rec.index * step, step: 0, max: 1, elapsed: (now - rec.start) / 1000 });
  }
}

/** Fade an element in without moving it. */
export function fade(el, { delay = 0, duration = 0.24 } = {}) {
  if (!motionOK() || !visible(el)) return;
  settle(animate(el, { opacity: [0, 1] }, { duration, delay, ease: 'easeOut' }), el, ['opacity']);
}

/** Slide a panel in from the side it came from: dir 1 from the right, -1 from the left. */
export function slideIn(el, dir = 1, { distance = 28, duration = 0.3 } = {}) {
  if (!motionOK() || !visible(el)) return;
  settle(
    animate(
      el,
      { opacity: [0, 1], transform: [`translateX(${dir * distance}px)`, 'translateX(0px)'] },
      { duration, ease: EASE_OUT },
    ),
    el,
    ['opacity', 'transform'],
  );
}

/** A small pop, for something that just appeared: a new token, a freshly saved row. */
export function pop(el, { duration = 0.38 } = {}) {
  if (!motionOK() || !visible(el)) return;
  settle(
    animate(
      el,
      { opacity: [0, 1], transform: ['scale(0.96) translateY(6px)', 'scale(1) translateY(0px)'] },
      { type: 'spring', duration, bounce: 0.22 },
    ),
    el,
    ['opacity', 'transform'],
  );
}

/**
 * Open a collapsed block: height from nothing to what it needs, while the content fades in.
 * Run it right after the block is in the DOM. Height is measured once, so nothing reflows per frame.
 */
export function expand(el, { duration = 0.28 } = {}) {
  if (!motionOK() || !visible(el)) return;
  const height = el.getBoundingClientRect().height;
  if (!height) return;
  el.style.overflow = 'hidden';
  const controls = animate(
    el,
    { height: ['0px', `${height}px`], opacity: [0, 1] },
    { duration, ease: EASE_OUT },
  );
  const done = () => {
    for (const p of ['height', 'opacity', 'overflow']) el.style.removeProperty(p);
  };
  controls.finished.then(done, done);
}

/** Take an element away: fade and drop, then call `done`. With motion off, `done` runs at once. */
export function leave(el, done, { duration = 0.16 } = {}) {
  if (!motionOK() || !visible(el)) {
    done?.();
    return;
  }
  const finish = () => done?.();
  animate(el, { opacity: [1, 0], transform: ['translateY(0px)', 'translateY(6px)'] }, { duration, ease: 'easeIn' }).finished.then(
    finish,
    finish,
  );
}
