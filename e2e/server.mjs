// Starts Postern for the browser tests: builds the binary from ./cmd/postern, gives it a fresh data
// directory, and runs it until Playwright stops this script.
//
// The UI is the one embedded in the binary (not POSTERN_DEV), so the tests see what ships.
// Set E2E_BIN to a prebuilt binary to skip the build.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.E2E_PORT || '18080';
const dir = mkdtempSync(join(tmpdir(), 'postern-e2e-'));
const bin = process.env.E2E_BIN || join(dir, process.platform === 'win32' ? 'postern.exe' : 'postern');

if (!process.env.E2E_BIN) {
  const build = spawnSync('go', ['build', '-o', bin, './cmd/postern'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    process.exit(build.status ?? 1);
  }
}

const child = spawn(bin, [], {
  cwd: dir,
  stdio: 'inherit',
  env: {
    ...process.env,
    ADMIN_PASSWORD: process.env.E2E_PASSWORD || 'e2e-password',
    LISTEN: `127.0.0.1:${port}`,
    ADMIN_LISTEN: '',
    POSTERN_DATA: join(dir, 'postern-data.json'),
    POSTERN_UPDATE_CHECK: 'off',
    POSTERN_SECURE: '0',
    POSTERN_DEV: '',
    POSTERN_KEY: '',
    POSTERN_KEY_FILE: '',
    POSTERN_TRUSTED_PROXIES: '',
  },
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  setTimeout(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  }, 300);
}

child.on('exit', (code) => stop(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => stop(0));
