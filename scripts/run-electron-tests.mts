/**
 * Spawns the Electron binary with electron-test-main.mjs to run
 * e2e pipeline tests inside a real Electron environment.
 *
 * Usage:
 *   npx tsx scripts/run-electron-tests.mts
 */
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

// Build the project to ensure dist/ is up-to-date
console.error('[run-electron-tests] Building project (tsc)...');
try {
  execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });
} catch {
  console.error('[run-electron-tests] Build failed');
  process.exit(1);
}

// electron's default export is the path to the Electron binary
const require = createRequire(import.meta.url);
const electronPath: string = require('electron') as unknown as string;

const mainScript = resolve(projectRoot, 'scripts', 'electron-test-main.mjs');

console.error(`[run-electron-tests] Electron binary: ${electronPath}`);
console.error(`[run-electron-tests] Main script: ${mainScript}`);

const child = spawn(electronPath, [mainScript], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    NODE_ENV: 'test',
  },
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('[run-electron-tests] Failed to spawn Electron:', err);
  process.exit(1);
});
