// Rebuilds web/js/vendor/motion-mini.js from the `motion` devDependency: `npm run vendor:motion`.
//
// The admin UI has no JS bundler and a strict CSP (scripts from 'self' only), so the one library it
// uses is committed as a single ES module. Only the mini build is taken: Motion's animate() on top
// of the Web Animations API, about 8 KB minified (3 KB gzipped). The MIT licence text is written
// into the file's own banner, because the Docker context leaves out *.md files.
// After upgrading `motion` in package.json, run this and commit the result.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'js', 'vendor');
const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'motion', 'package.json'), 'utf8'));

mkdirSync(out, { recursive: true });

const result = await build({
  stdin: { contents: "export { animate } from 'motion/mini';", resolveDir: root, loader: 'js' },
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  write: false,
});

const licence = readFileSync(join(root, 'node_modules', 'motion', 'LICENSE.md'), 'utf8').replace(/\*\//g, '* /').trim();
const banner = `/*! Motion ${pkg.version} (mini build), rebuilt by scripts/vendor-motion.mjs\n\n${licence}\n*/\n`;
writeFileSync(join(out, 'motion-mini.js'), banner + result.outputFiles[0].text);
console.log(`motion ${pkg.version} -> web/js/vendor/motion-mini.js (${result.outputFiles[0].text.length} bytes)`);
