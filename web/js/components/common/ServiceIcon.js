import { h } from '../../lib/h.js';
import { nameTile } from '../../lib/serviceDisplay.js';
import { serviceIconURL } from '../../lib/apps.js';

/**
 * A service's icon: its uploaded icon, else its app's bundled icon, else a letter tile in a colour
 * that stays the same for the same name. An image that fails to load falls back to the tile.
 *
 * Returns { el, update({ name, app, icon }) } so a header can follow the draft as it changes.
 * `size` is 'xs' (request log), 'sm' (palette), 'row' (service list), 'md' (default, phone list)
 * or 'lg' (drawer header, picker preview).
 */
export function ServiceIcon({ name = '', app = '', icon = '', size = 'md', className = '' } = {}) {
  const el = h('span', { className: `svc-icon svc-icon-${size} ${className}`.trim(), 'aria-hidden': 'true' });
  let cur = {};

  function update(next = {}) {
    const props = { ...cur, ...next };
    const src = serviceIconURL(props);
    const sameImage = src && src === serviceIconURL(cur);
    cur = props;
    if (sameImage) {
      // The image failed earlier and the tile shows instead; keep its letters current.
      if (el.classList.contains('svc-icon-letter')) letter();
      return;
    }
    if (src) {
      el.classList.remove('svc-icon-letter');
      el.style.removeProperty('--tile-hue');
      const img = h('img', { src, alt: '', draggable: 'false', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => {
        if (serviceIconURL(cur) === src) letter();
      });
      el.replaceChildren(img);
    } else {
      letter();
    }
  }

  function letter() {
    el.classList.add('svc-icon-letter');
    el.style.setProperty('--tile-hue', String(hueFor(cur.name)));
    el.replaceChildren(nameTile(cur.name));
  }

  update({ name, app, icon });
  return { el, update };
}

/** A hue from the name, so each service keeps its colour between visits. */
export function hueFor(name) {
  let n = 0;
  for (const ch of String(name || '')) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return n % 360;
}
