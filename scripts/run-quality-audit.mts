/**
 * Quality audit script — runs real-world URLs through the extraction pipeline
 * and dumps detailed diagnostics to evaluate extraction quality.
 *
 * Usage:
 *   npx tsx scripts/run-quality-audit.mts
 *
 * This spawns Electron with scripts/quality-audit-main.mjs
 */
import { execSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

console.error('[quality-audit] Building project (tsc)...');
execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });

const electronBin = resolve(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const mainScript = resolve(projectRoot, 'scripts', 'quality-audit-main.mjs');

console.error(`[quality-audit] Electron binary: ${electronBin}`);
console.error(`[quality-audit] Main script: ${mainScript}`);

const child = spawn(electronBin, ['--no-sandbox', mainScript], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
