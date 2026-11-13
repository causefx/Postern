// One-command dev loop: `npm run dev`.
//
//   - Tailwind rebuilds web/app.css on every change. It runs with
//     `--watch=always`: plain `--watch` exits when stdin closes, as it does here.
//   - The server runs with POSTERN_DEV=1, so HTML/JS/CSS edits only need a
//     browser refresh.
//   - Saving a .go file under cmd/ rebuilds and restarts the server.
//
// The server is built to a temp binary and run directly rather than through
// `go run`, so stopping it kills the real process (on Windows, killing
// `go run` leaves the compiled child holding the port).
//
// Defaults, each overridden by setting the variable yourself:
//   ADMIN_PASSWORD=dev        a fixed password, so every restart keeps your session
//   LISTEN=127.0.0.1:8080     loopback only, because that password is public knowledge
//   POSTERN_DEV=1             set POSTERN_DEV=0 to embed the UI instead
// Any other variable passes straight through to the server.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PASSWORD = 'dev';
const isWin = process.platform === 'win32';
const outDir = mkdtempSync(join(tmpdir(), 'postern-dev-'));
const bin = join(outDir, isWin ? 'postern.exe' : 'postern');

function log(tag, line) {
  console.log(`[${tag}] ${line}`);
}

function pipe(child, tag) {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const line of lines) if (line.trim()) log(tag, line);
    });
  }
}

function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

// --- Tailwind -------------------------------------------------------------

const cliDir = join(root, 'node_modules', '@tailwindcss', 'cli');
let cliEntry;
try {
  const pkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
  cliEntry = join(cliDir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tailwindcss);
} catch {
  console.error('Tailwind is not installed. Run `npm install` first.');
  process.exit(1);
}

const css = spawn(
  process.execPath,
  [cliEntry, '-i', './web/input.css', '-o', './web/app.css', '--watch=always', '--poll'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
pipe(css, 'css');
css.on('exit', (code) => {
  if (!stopping) log('css', `exited (${code}); stopping`);
  shutdown(code ?? 1);
});

// --- Go server ------------------------------------------------------------

let server = null;
let working = false;
let again = false;
let stopping = false;

function stopServer() {
  return new Promise((done) => {
    if (!server || server.exitCode !== null) {
      server = null;
      return done();
    }
    const s = server;
    server = null;
    s.once('exit', () => done());
    kill(s);
  });
}

function startServer() {
  const env = {
    ...process.env,
    POSTERN_DEV: process.env.POSTERN_DEV ?? '1',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? DEV_PASSWORD,
    // A well-known password must not be reachable from the LAN.
    LISTEN: process.env.LISTEN ?? '127.0.0.1:8080',
  };
  server = spawn(bin, [], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  pipe(server, 'go');
  const me = server;
  me.on('exit', (code, signal) => {
    if (server === me) {
      server = null;
      log('go', `server exited (${signal ?? code}); save a .go file to restart`);
    }
  });
}

async function rebuild() {
  if (working) {
    again = true;
    return;
  }
  working = true;
  try {
    do {
      again = false;
      // A running .exe cannot be overwritten on Windows, so stop it first.
      await stopServer();
      log('go', 'building');
      const built = spawnSync('go', ['build', '-o', bin, './cmd/postern'], {
        cwd: root,
        stdio: 'inherit',
      });
      if (built.status === 0) startServer();
      else log('go', 'build failed; fix it and save to retry');
    } while (again && !stopping);
  } finally {
    working = false;
  }
}

let timer = null;
watch(join(root, 'cmd'), { recursive: true }, (_event, name) => {
  if (!name || !name.endsWith('.go') || name.endsWith('_test.go')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    log('go', `changed: ${name}`);
    rebuild();
  }, 250);
});

// --- Shutdown -------------------------------------------------------------

let done = false;
function shutdown(code = 0) {
  if (done) return;
  done = true;
  stopping = true;
  clearTimeout(timer);
  kill(css);
  kill(server);
  setTimeout(() => {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* the binary may still be releasing; the OS temp cleaner gets it */
    }
    process.exit(code);
  }, 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  kill(css);
  kill(server);
});

log(
  'dev',
  `Tailwind + server starting. UI: http://${process.env.LISTEN ?? '127.0.0.1:8080'}/admin/` +
    (process.env.ADMIN_PASSWORD ? '' : `  password: ${DEV_PASSWORD}`) +
    '  (Ctrl+C stops both)',
);
rebuild();
