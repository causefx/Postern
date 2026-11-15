// Renders scenes of compose.html frame by frame with Playwright and pipes them to ffmpeg.
//
//   node promo/render.mjs                 every scene, to promo/build/<scene>.mp4 (+ caption PNGs)
//   node promo/render.mjs dash palette    only these
//   node promo/render.mjs --still dash 2  one PNG of that scene at t=2s, for checking a frame
//
// Playwright comes from e2e/node_modules, so run `npm ci` in e2e/ first.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');
const FPS = 30;
const build = join(here, 'build');
mkdirSync(build, { recursive: true });

const args = process.argv.slice(2);
const still = args[0] === '--still';
const all = ['title', 'dash', 'palette', 'scope', 'requests', 'theme', 'mobile', 'wall', 'end', 'cap-theme', 'cap-mobile', 'cap-intro'];
const scenes = still ? [args[1]] : (args.length ? args : all);

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'compose.html')).href);
await page.evaluate(() => window.ready());

for (const name of scenes) {
  const dur = await page.evaluate((n) => window.setScene(n), name);
  if (still || dur === 0) {
    const t = still ? Number(args[2] || 0) : 0;
    await page.evaluate((x) => window.seek(x), t);
    const file = join(build, still ? `still-${name}-${t}.png` : `${name}.png`);
    await page.screenshot({ path: file, omitBackground: name.startsWith('cap-') });
    console.log('wrote', file);
    continue;
  }
  const file = join(build, `${name}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round(dur * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((x) => window.seek(x), i / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())));
  console.log('wrote', file, `${frames} frames`);
}
await browser.close();
