// Turns the raw pictures from `npm run screenshots` into what the repository keeps:
//
//   docs/screenshots/{desktop,mobile}/<name>-{dark,light}.webp   lossless WebP, about a third the size of the PNG
//   docs/gallery.md                                              the gallery page, written from the list below
//
//   cd e2e && npm run screenshots && npm run screenshots:publish
//
// Needs ffmpeg on the PATH (it does the WebP encoding). The README points at a few of these files by
// name, so renaming an entry here means updating the README too.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const outRoot = join(here, 'out');
const docs = join(repo, 'docs');
const imgRoot = join(docs, 'screenshots');

// kind: 'd' = desktop (1440 wide), 'm' = phone. `name` is the screen's name in the run's file names.
const D = (name, alt, caption) => ({ kind: 'desktop', name, alt, caption });
const M = (name, alt) => ({ kind: 'mobile', name, alt });

const SECTIONS = [
  {
    title: 'Sign in',
    blurb: 'The password sign-in, with the diagram of what a caller sends and what the service receives. With OpenID Connect set up, a second button appears beside the password.',
    items: [
      D('login', 'The sign-in page', 'Sign in'),
      D('login-wrong-password', 'The sign-in page after a wrong password', 'A wrong password says so and keeps the field focused'),
    ],
  },
  {
    title: 'Dashboard',
    blurb: 'Every service, with its route, upstream, how callers get in and what it last did. Press `Ctrl` or `⌘` `K` for the command palette, or tick rows for bulk actions.',
    items: [
      D('dashboard-empty', 'The dashboard before any service exists', 'First run'),
      D('dashboard', 'The dashboard with eight services', 'The dashboard'),
      D('dashboard-selection', 'Two services selected, with the bulk action bar', 'Tick rows for bulk actions'),
      D('palette-search', 'The command palette searching for plex', 'The command palette'),
      D('account-menu', 'The account menu with Settings, Theme and Sign out', 'The account menu'),
    ],
  },
  {
    title: 'Add a service',
    blurb: 'A name, the upstream address and its credentials. A preset fills in the credential shape for common apps. The upstream key is stored on the server and never shown again.',
    items: [
      D('add-service-filled', 'The add service drawer, filled in from the *arr preset', 'Add a service from a preset'),
      D('add-service-error', 'The add service drawer refusing an empty form', 'A form that is not ready is refused with the reason'),
    ],
  },
  {
    title: 'Edit a service',
    blurb: 'Everything about one service lives in a drawer with five tabs. Edits are marked until saved.',
    items: [
      D('edit-connection', 'The Connection tab of a service', 'Connection: name, upstream and credentials'),
      D('edit-access', 'The Access tab with three caller tokens', 'Access: how callers get in, and their tokens'),
      D('edit-access-scope', 'Limiting a token to read-only methods and one path', 'Limit a token to some methods and paths'),
      D('edit-access-expiry', 'Setting an expiry date on a token', 'Give a token an expiry date'),
      D('edit-open-paths', 'The Advanced tab with open paths', 'Advanced: paths that need no token'),
      D('edit-requests', 'The service request log', 'Requests: what callers did, with refusals marked'),
      D('edit-how-to-use', 'The How to use tab with copy-ready examples', 'How to use: examples with the real address'),
      D('edit-unsaved', 'The unsaved changes dialog', 'Closing with edits asks what to do'),
      D('edit-rotate-token', 'The rotate token dialog', 'Rotate a token'),
      D('edit-delete-confirm', 'The delete confirmation, which needs the name typed', 'Delete asks for the name'),
      D('dialog-duplicate', 'The duplicate service dialog', 'Duplicate a service'),
      D('dialog-bulk-rotate', 'Rotating the tokens of two selected services', 'Rotate several tokens at once'),
    ],
  },
  {
    title: 'Settings',
    blurb: 'Rate limit, log sizes, sign-in options and which sites may embed the admin UI. Changes are held until you press Save, and each save is written to the admin log.',
    items: [
      D('settings', 'The settings drawer', 'Settings'),
      D('settings-rate-limit', 'The rate limit setting expanded', 'A setting with presets and a stepper'),
      D('settings-saved-toast', 'The settings saved notification', 'Saved, and logged'),
      D('settings-embedding', 'The embedding setting with two allowed sites', 'Allow a dashboard to embed the admin UI'),
      D('settings-requests-tab', 'The request log for all services', 'Requests: every service in one list'),
      D('settings-admin-log-tab', 'The admin log', 'Admin log: who changed what'),
    ],
  },
  {
    title: 'Backup: export and import',
    blurb: 'Copy your services out as one JSON file, and read them back in. An import is checked first with a dry run, and nothing is applied unless every service passes.',
    items: [
      D('settings-export-redacted', 'Exporting a redacted config', 'Export without secrets, safe to share'),
      D('settings-export-full', 'Exporting a full backup', 'Or a full backup, which needs a tick to confirm'),
      D('settings-import', 'The import screen', 'Import from a file or pasted JSON'),
      D('settings-import-unknown-field', 'An import refused because of a misspelt field', 'A misspelt field is an error, not silently dropped'),
      D('settings-import-review', 'The import review: one create, one skip, one error', 'Review what would happen before anything changes'),
    ],
  },
  {
    title: 'On a phone',
    blurb: 'The same screens on a phone: a list instead of a table, drawers and the account menu as sheets that slide up. Swipe a row for quick actions, or press and hold to select several.',
    phone: true,
    items: [
      M('login', 'Sign in'),
      M('dashboard', 'The service list'),
      M('palette-search', 'The command palette'),
      M('account-menu', 'The account menu'),
      M('add-service-filled', 'Adding a service'),
      M('edit-access', 'A service: Access'),
      M('edit-requests', 'A service: Requests'),
      M('settings', 'Settings'),
      M('settings-export-redacted', 'Exporting a config'),
      M('settings-import-review', 'Reviewing an import'),
    ],
  },
];

// ---------------------------------------------------------------- pictures

const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpeg.error || ffmpeg.status !== 0) {
  console.error('ffmpeg is needed to write the WebP files. Install it and run this again.');
  process.exit(1);
}

function find(kind, theme, name) {
  const dir = join(outRoot, `${kind}-${theme}`);
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f.replace(/^\d+-/, '') === `${name}.png`);
  return hit ? join(dir, hit) : null;
}

let made = 0;
const missing = [];
for (const section of SECTIONS) {
  for (const item of section.items) {
    for (const theme of ['dark', 'light']) {
      const src = find(item.kind, theme, item.name);
      if (!src) {
        missing.push(`${item.kind}-${theme}/${item.name}`);
        continue;
      }
      const dest = join(imgRoot, item.kind, `${item.name}-${theme}.webp`);
      mkdirSync(dirname(dest), { recursive: true });
      const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', dest], { encoding: 'utf8' });
      if (run.status !== 0) {
        console.error(`could not convert ${src}\n${run.stderr}`);
        process.exit(1);
      }
      made += 1;
    }
  }
}
if (missing.length) {
  console.error(`Pictures not found (run npm run screenshots first):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------- the gallery page

/** One picture that follows the viewer's GitHub theme: the dark file for dark mode, the light one otherwise. */
function picture(item, { width, base = 'screenshots' }) {
  const file = (theme) => `${base}/${item.kind}/${item.name}-${theme}.webp`;
  return [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${file('dark')}">`,
    `  <img src="${file('light')}" alt="${item.alt}" width="${width}">`,
    '</picture>',
  ].join('\n');
}

const lines = [];
lines.push('# Gallery');
lines.push('');
lines.push('Every screen of the admin UI, in the order you meet them. The pictures follow your GitHub theme (dark or light). Both versions of each are in [`screenshots/`](screenshots/), together with the phone layouts.');
lines.push('');
lines.push('The services shown are made up, and so are their keys. [`e2e/screenshots/`](../e2e/screenshots/) takes the pictures and rebuilds this page: `npm run screenshots`, then `npm run screenshots:publish`.');
lines.push('');
lines.push(SECTIONS.map((s) => `- [${s.title}](#${s.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-')})`).join('\n'));
lines.push('');

for (const section of SECTIONS) {
  lines.push(`## ${section.title}`);
  lines.push('');
  lines.push(section.blurb);
  lines.push('');
  if (section.phone) {
    // Phones side by side, four to a row.
    for (let i = 0; i < section.items.length; i += 4) {
      const row = section.items.slice(i, i + 4);
      lines.push('<table>');
      lines.push('<tr>');
      for (const item of row) {
        lines.push('<td align="center">');
        lines.push('');
        lines.push(picture(item, { width: 200 }));
        lines.push('');
        lines.push(`<sub>${item.alt}</sub>`);
        lines.push('');
        lines.push('</td>');
      }
      lines.push('</tr>');
      lines.push('</table>');
      lines.push('');
    }
    continue;
  }
  for (const item of section.items) {
    lines.push(`**${item.caption}**`);
    lines.push('');
    lines.push(picture(item, { width: 900 }));
    lines.push('');
  }
}
writeFileSync(join(docs, 'gallery.md'), lines.join('\n'));

console.log(`${made} pictures written to docs/screenshots/, and docs/gallery.md`);
