/**
 * Bundle @mozilla/readability into a standalone IIFE for injection via executeJavaScript.
 * The bundle exposes `window.__Readability` and `window.__isProbablyReaderable`.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(__dirname, '..', 'vendor', 'Readability.js');

// Create a temporary entry that re-exports Readability as globals
const entryContent = `
import { Readability, isProbablyReaderable } from '@mozilla/readability';
window.__Readability = Readability;
window.__isProbablyReaderable = isProbablyReaderable;
`;

const entryPath = resolve(__dirname, '..', 'vendor', '_readability_entry.mjs');
mkdirSync(dirname(entryPath), { recursive: true });
writeFileSync(entryPath, entryContent);

try {
  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: outFile,
    minify: true,
    sourcemap: false,
  });
  console.error(`[bundle-readability] Built ${outFile}`);
} finally {
  // Clean up temp entry
  try {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(entryPath);
  } catch {
    // ignore
  }
}
