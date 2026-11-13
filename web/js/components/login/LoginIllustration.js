/**
 * Key-swap diagram for the login screen: each request arrives with a Postern token and the service
 * receives its real key, masked. Refused requests are never forwarded. The list scrolls on its own
 * (SMIL), one row at a time.
 *
 * Inline so it can follow the app theme: the colours are --pk-* variables defined in input.css
 * (dark by default, light under [data-theme="light"]).
 */

const MONO = 'JetBrains Mono, monospace';
const ROW_H = 56;
const FIRST_Y = 84;

/** One request per row. `via` is how the caller sends the token; `key` is what the service gets. */
const REQUESTS = [
  { method: 'GET', path: '/p/sonarr/api/v3/series', via: '?token=pst_8f2a…', to: 'sonarr/api/v3/series', key: 'X-Api-Key: ••••••3c1a', status: 200 },
  { method: 'GET', path: '/p/plex/library/sections', via: 'X-Postern: pst_19bd…', to: 'plex/library/sections', key: '?X-Plex-Token=••••w7Qe', status: 200 },
  { method: 'GET', path: '/p/radarr/api/v3/movie', via: 'no token', status: 401 },
  { method: 'GET', path: '/p/jellyfin/Items', via: 'Bearer pst_c04e…', to: 'jellyfin/Items', key: 'Authorization: ••••••e91f', status: 200 },
  { method: 'POST', path: '/p/sabnzbd/api', via: '?token=pst_77aa…', to: 'sabnzbd/api', key: '?apikey=••••••0b2d', status: 200 },
  { method: 'GET', path: '/p/prowlarr/api/v1/search', via: '?token=pst_d3… (paused)', status: 403 },
  { method: 'GET', path: '/p/qbit/api/v2/torrents', via: 'Bearer pst_5e10…', to: 'qbit/api/v2/torrents', key: 'Basic ••••:••••', status: 200 },
];

function text(x, y, size, fill, body, extra = '') {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`;
}

function row(req, i) {
  const y = FIRST_Y + ROW_H * i;
  const ok = !!req.to;
  const tone = ok ? 'var(--pk-ok)' : 'var(--pk-warn)';
  const badge = ok ? 'var(--pk-ok-bg)' : 'var(--pk-warn-bg)';
  const out = [
    text(24, y, 11.5, 'var(--pk-mute)', req.method),
    text(req.method === 'POST' ? 59 : 52, y, 11.5, 'var(--pk-ink)', req.path),
    text(24, y + 18, 11, ok ? 'var(--pk-soft)' : 'var(--pk-warn)', req.via),
  ];
  if (ok) {
    out.push(
      `<path d="M308 ${y + 6} H330" stroke="var(--pk-soft)" stroke-opacity=".5" stroke-width="1.25"/>`,
      `<path d="M326 ${y + 2} l4 4 -4 4" fill="none" stroke="var(--pk-soft)" stroke-opacity=".5" stroke-width="1.25"/>`,
      text(344, y, 11.5, 'var(--pk-ink)', req.to),
      text(344, y + 18, 11, tone, req.key),
    );
  } else {
    out.push(
      `<path d="M320 ${y + 2} l8 8 M328 ${y + 2} l-8 8" stroke="${tone}" stroke-width="1.75" stroke-linecap="round"/>`,
      text(344, y + 9, 11, 'var(--pk-mute)', 'never forwarded', ' font-style="italic"'),
    );
  }
  out.push(
    `<rect x="580" y="${y - 5}" width="36" height="19" rx="5" fill="${badge}"/>`,
    text(598, y + 9, 11, tone, String(req.status), ' text-anchor="middle" font-weight="700"'),
  );
  return out.join('');
}

/** Two passes over the list so the scroll can wrap without a jump. */
function rows() {
  const all = [...REQUESTS, ...REQUESTS];
  return all.map(row).join('');
}

/** Hold each row for a beat, then move up by one row; the last step lands on the second pass. */
function scroll() {
  const steps = REQUESTS.length;
  // Seconds per row. 50% faster than the original 2.2s.
  const dur = (2.2 / 1.5) * steps;
  const values = [];
  const keyTimes = [];
  const move = 0.22;
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    const y = -ROW_H * s;
    const next = -ROW_H * (s + 1);
    values.push(`0 ${y}`, `0 ${y}`);
    keyTimes.push(t0, t1 - (t1 - t0) * move);
    if (s === steps - 1) {
      values.push(`0 ${next}`);
      keyTimes.push(1);
    }
  }
  return `<animateTransform attributeName="transform" type="translate" values="${values.join(';')}" keyTimes="${keyTimes
    .map((k) => k.toFixed(4))
    .join(';')}" dur="${dur}s" repeatCount="indefinite"/>`;
}

function markup(animate) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Each request arrives with a Postern token; Postern swaps it for the service's real key, shown masked. Refused requests are never forwarded." class="postern-illustration pk-art" fill="none">
<defs>
<clipPath id="pk-clip"><rect x="0" y="50" width="640" height="410"/></clipPath>
<linearGradient id="pk-fade-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg-surface)"/><stop offset="1" stop-color="var(--bg-surface)" stop-opacity="0"/></linearGradient>
<linearGradient id="pk-fade-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg-surface)" stop-opacity="0"/><stop offset="1" stop-color="var(--bg-surface)"/></linearGradient>
</defs>
<text x="24" y="28" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" letter-spacing="1.5" fill="var(--pk-mute)">CALLER SENDS</text>
<text x="344" y="28" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" letter-spacing="1.5" fill="var(--pk-mute)">SERVICE RECEIVES</text>
<g clip-path="url(#pk-clip)"><g>${rows()}${animate ? scroll() : ''}</g></g>
<rect x="0" y="50" width="640" height="56" fill="url(#pk-fade-top)"/>
<rect x="0" y="404" width="640" height="56" fill="url(#pk-fade-bottom)"/>
<path d="M322 46 V460" stroke="var(--pk-line)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
<g transform="translate(306 230)">
<rect x="-6" y="-6" width="44" height="48" rx="10" fill="var(--bg-surface)"/>
<path d="M4 34 V16 A12 12 0 0 1 28 16 V34" fill="var(--bg-page)" stroke="var(--pk-door)" stroke-width="2"/>
<path d="M0 34 H32" stroke="var(--pk-door)" stroke-width="2" stroke-linecap="round"/>
<circle cx="16" cy="20" r="2.5" fill="none" stroke="var(--pk-soft)" stroke-width="1.5"/>
</g>
</svg>`;
}

export function LoginIllustration() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wrap = document.createElement('div');
  wrap.innerHTML = markup(!reduce).trim();
  return wrap.firstElementChild;
}
