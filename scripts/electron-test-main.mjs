/**
 * Electron main-process test runner for real-Electron e2e pipeline tests.
 *
 * Invoked by the Electron binary:
 *   electron scripts/electron-test-main.mjs
 *
 * Responsibilities:
 *   1. Wait for Electron app.whenReady()
 *   2. Start the fixture HTTP server on a random port
 *   3. Build the project (tsc) to ensure dist/ is fresh
 *   4. Dynamically import extractUrl from dist/
 *   5. Run each test case sequentially with node:assert
 *   6. Report results and exit with appropriate code
 *
 * Why not vitest?
 *   vitest always runs tests in forked workers or VM threads, neither of
 *   which have access to Electron main-process APIs (BrowserWindow, session).
 *   This runner executes directly in the Electron main process where
 *   `import { BrowserWindow, session } from 'electron'` resolves to real APIs.
 */

import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Disable sandboxing at the app level to prevent Mach port rendezvous failures
// when rapidly creating/destroying BrowserWindows with unique session partitions.
app.commandLine.appendSwitch('no-sandbox');

// Prevent app from quitting when all extraction windows are closed between tests.
// Without this, Electron's default behaviour triggers shutdown as soon as the
// pipeline destroys its BrowserWindow, killing the next renderer bootstrap.
app.on('window-all-closed', (e) => e.preventDefault());

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');
const fixturesDir = resolve(projectRoot, 'tests', 'fixtures', 'e2e');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
};

// ── Fixture HTTP server ──────────────────────────────────────────────

function startFixtureServer() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(async (req, res) => {
      const urlPath = req.url?.split('?')[0] ?? '/';
      const safePath = urlPath.replace(/\.\./g, '');
      const filePath = resolve(fixturesDir, safePath.replace(/^\//, ''));

      if (!filePath.startsWith(fixturesDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      try {
        const content = await readFile(filePath);
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolvePromise({ server, port: address.port });
      } else {
        rejectPromise(new Error('Failed to get server address'));
      }
    });

    server.on('error', rejectPromise);
  });
}

// ── Test runner ──────────────────────────────────────────────────────

const results = { pass: 0, fail: 0, skip: 0, errors: [] };
const startTime = Date.now();

async function runTest(name, fn, timeoutMs = 45000) {
  const testStart = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    results.pass++;
    const elapsed = Date.now() - testStart;
    console.error(`  ✔ ${name} (${elapsed}ms)`);
  } catch (err) {
    results.fail++;
    const elapsed = Date.now() - testStart;
    const message = err?.message || String(err);
    results.errors.push({ name, error: message });
    console.error(`  ✖ ${name} (${elapsed}ms)`);
    console.error(`    ${message}`);
    if (err?.stack) console.error(`    STACK: ${err.stack.split('\n').slice(0, 5).join('\n    ')}`);
    if (err?.cause) console.error(`    CAUSE: ${err.cause?.message || err.cause}`);
  }
}

// ── Fixture expectations ─────────────────────────────────────────────

const expected = {
  'simple-article.html': {
    with: [
      'City Transit Board Approves Overnight Service Pilot',
      'six-month overnight service pilot',
      'Blue and Green rail lines',
      'restaurant workers, hospital staff, and airport employees',
      'Board chair Elena Ruiz',
      'final recommendation before the winter budget cycle',
    ],
    without: [],
    minQuality: 65,
    hasTitle: true,
    hasAuthor: true,
  },
  'article-with-ads.html': {
    with: [
      'How Regional Newsrooms Share Climate Data',
      'regional editors now begins each morning with the same flood map',
      'common data dictionary',
      'rotating verification shift',
      'public methods page describing sourcing',
    ],
    without: [
      'cookie technology',
      'Accept cookie settings',
      'sponsor message',
      'Share on X',
      'Share on LinkedIn',
    ],
    minQuality: 55,
    hasTitle: true,
    hasAuthor: false,
  },
  'article-with-metadata.html': {
    with: [
      "Inside the Public Library's Digital Preservation Lab",
      'secured room below the main reading hall',
      'forensic disk images and run checksum validation',
      'Oral-history interviews',
      'Lab director Naomi Fields',
    ],
    without: [],
    minQuality: 65,
    hasTitle: true,
    hasAuthor: true,
  },
  'lazy-images.html': {
    with: [
      'Field Notes From the River Restoration Corridor',
      'reopening side channels',
      'temperature and dissolved oxygen every six hours',
      'more birds and fewer flooding concerns',
      'insect abundance against pre-project baselines',
    ],
    without: [],
    minQuality: 60,
    hasTitle: true,
    hasAuthor: false,
  },
  'heavy-navigation.html': {
    with: [
      'Morning Briefing: Regional Rail Update',
      'overnight switch repairs finished ahead of schedule',
      'weekend bus bridges will continue',
      'elevator access improvements',
    ],
    without: ['Classifieds', 'Privacy Policy', 'Terms of Use', 'Cookie Policy', 'TikTok', 'Mastodon'],
    minQuality: 35,
    hasTitle: true,
    hasAuthor: false,
  },
  'js-rendered.html': {
    with: [
      'Live Blog: Emergency Preparedness Drill',
      'coordinated emergency drill Tuesday morning',
      'shared incident board',
      'multilingual templates improved readability',
      'after-action memo next week',
    ],
    without: ['JavaScript is disabled', 'noscript mode'],
    minQuality: 55,
    hasTitle: true,
    hasAuthor: false,
  },
  'empty-page.html': {
    with: [],
    without: [],
    minQuality: 0,
    maxQuality: 30,
    hasTitle: false,
    hasAuthor: false,
  },
  'large-page.html': {
    with: [
      'Decade-Long Reinvention of Harbor District Transit',
      'modernize two stations',
      'Planning, Then Replanning',
      'Construction in a Changing Climate',
      'Neighborhood Effects',
      'Operational Lessons and Measured Results',
      'What Comes Next',
      'integrated fare capping',
    ],
    without: [],
    minQuality: 70,
    hasTitle: true,
    hasAuthor: false,
  },
  'csr-delayed.html': {
    with: [
      'Delayed Article: Urban Farming Initiative',
      'urban farming initiative',
      'community gardens',
      'composting pilot',
      'Council member Rivera',
    ],
    without: ['Loading...'],
    minQuality: 50,
    hasTitle: true,
    hasAuthor: false,
    // CSR fixture injects content after 2s delay — needs higher settle time
    settleMs: 5000,
  },
};

// ── Main ─────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[electron-e2e] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[electron-e2e] UNHANDLED REJECTION:', reason);
});

app.whenReady().then(async () => {
  console.error('[electron-e2e] Electron ready');

  // Keep a hidden window alive so Electron never enters zero-window state.
  // This prevents macOS Mach port rendezvous failures between sequential
  // BrowserWindow create/destroy cycles in the pipeline.
  const keepalive = new BrowserWindow({ show: false, width: 1, height: 1 });

  let server;
  let port;

  try {
    ({ server, port } = await startFixtureServer());
    console.error(`[electron-e2e] Fixture server on port ${port}`);

    // Import compiled modules from dist/
    const { extractUrl } = await import(resolve(projectRoot, 'dist', 'extraction', 'pipeline.js'));
    const { loadConfig } = await import(resolve(projectRoot, 'dist', 'util', 'config.js'));

    const fixtureBase = `http://localtest.me:${port}`;

    const config = {
      ...loadConfig(),
      headlessMode: true,
      resourceBlockImages: true,
      resourceBlockMedia: true,
      resourceBlockFonts: true,
      defaultTimeoutMs: 30000,
      defaultSettleMs: 500,
      maxCharsDefault: 50000,
      browserConcurrency: 1,
    };

    const defaultOptions = {
      outputFormat: 'text',
      maxChars: 50000,
      timeoutMs: 30000,
      waitUntil: 'load',
      settleMs: 1200,
    };

    // ── Fixture extraction tests ──

    console.error('\n▶ E2E Pipeline Extraction');

    // Delay between sequential extractions to let macOS reclaim renderer processes
    const interTestDelay = () => new Promise(r => setTimeout(r, 1000));

    for (const [fixtureName, expectation] of Object.entries(expected)) {
      // empty-page.html is expected to throw READABILITY_EMPTY
      if (fixtureName === 'empty-page.html') {
        await runTest(`extracts ${fixtureName} correctly (expects error)`, async () => {
          await assert.rejects(
            () => extractUrl(`${fixtureBase}/${fixtureName}`, config, defaultOptions),
            (err) => {
              const msg = err.message || String(err);
              return msg.includes('READABILITY_EMPTY') || msg.includes('No extractable content');
            },
            'Expected extractUrl to throw READABILITY_EMPTY for empty page',
          );
        });
        await interTestDelay();
        continue;
      }

      await runTest(`extracts ${fixtureName} correctly`, async () => {
        const opts = expectation.settleMs ? { ...defaultOptions, settleMs: expectation.settleMs } : defaultOptions;
        const result = await extractUrl(`${fixtureBase}/${fixtureName}`, config, opts);
        const searchable = [result.title, result.byline, result.excerpt, result.textContent]
          .filter(Boolean).join(' ').toLowerCase();

        for (const phrase of expectation.with) {
          assert.ok(
            searchable.includes(phrase.toLowerCase()),
            `Expected "${phrase}" in textContent of ${fixtureName}`,
          );
        }

        for (const phrase of expectation.without) {
          assert.ok(
            !searchable.includes(phrase.toLowerCase()),
            `Did not expect "${phrase}" in textContent of ${fixtureName}`,
          );
        }

        assert.ok(
          result.score >= expectation.minQuality,
          `Score ${result.score} below minimum ${expectation.minQuality} for ${fixtureName}`,
        );

        if (typeof expectation.maxQuality === 'number') {
          assert.ok(
            result.score <= expectation.maxQuality,
            `Score ${result.score} above maximum ${expectation.maxQuality} for ${fixtureName}`,
          );
        }

        if (expectation.hasTitle) {
          assert.ok(result.title, `Expected title for ${fixtureName}`);
        }

        if (expectation.hasAuthor) {
          assert.ok(result.author, `Expected author for ${fixtureName}`);
        }
      });
      await interTestDelay();
    }

    // ── Truncation test ──

    console.error('\n▶ Truncation & Format Tests');

    await runTest('truncates large-page.html with small maxChars', async () => {
      const result = await extractUrl(`${fixtureBase}/large-page.html`, config, {
        ...defaultOptions,
        maxChars: 2000,
      });
      assert.ok(result.textContent.length <= 2200, `Text length ${result.textContent.length} exceeds 2200`);
      assert.ok(result.score >= 50, `Score ${result.score} below 50`);
    });
    await interTestDelay();

    // ── Format tests ──

    await runTest('returns markdown format when requested', async () => {
      const result = await extractUrl(`${fixtureBase}/large-page.html`, config, {
        ...defaultOptions,
        outputFormat: 'markdown',
      });
      assert.ok(result.content.includes('#'), 'Markdown content should contain # headings');
      assert.ok(result.content.includes('## '), 'Markdown content should contain ## level-2 headings');
      assert.strictEqual(result.outputFormat, 'markdown');
    });
    await interTestDelay();

    await runTest('returns html format when requested', async () => {
      const result = await extractUrl(`${fixtureBase}/simple-article.html`, config, {
        ...defaultOptions,
        outputFormat: 'html',
      });
      assert.ok(/<[a-z]/i.test(result.content), 'HTML content should contain HTML tags');
      assert.strictEqual(result.outputFormat, 'html');
    });
    await interTestDelay();

    await runTest('returns text format by default', async () => {
      const result = await extractUrl(`${fixtureBase}/simple-article.html`, config, defaultOptions);
      assert.strictEqual(result.outputFormat, 'text');
      assert.strictEqual(result.content, result.textContent);
    });
    await interTestDelay();

    // ── SSRF tests ──

    console.error('\n▶ SSRF Protection Tests');

    await runTest('blocks localhost URLs via SSRF protection', async () => {
      await assert.rejects(
        () => extractUrl('http://localhost:1234/blocked', config, defaultOptions),
        (err) => /private\/internal address blocked/i.test(err.message),
        'Expected SSRF rejection for localhost',
      );
    });

    await runTest('blocks 127.0.0.1 URLs via SSRF protection', async () => {
      await assert.rejects(
        () => extractUrl('http://127.0.0.1:1234/blocked', config, defaultOptions),
        (err) => /private\/internal address blocked/i.test(err.message),
        'Expected SSRF rejection for 127.0.0.1',
      );
    });
    await interTestDelay();

    // ── Metadata test ──

    console.error('\n▶ Metadata Tests');

    await runTest('returns fixture final URL and no READABILITY_FAILED warning for article pages', async () => {
      const result = await extractUrl(`${fixtureBase}/article-with-metadata.html`, config, defaultOptions);
      assert.ok(result.finalUrl.includes('article-with-metadata.html'), 'finalUrl should contain fixture name');
      assert.ok(!result.warnings.includes('READABILITY_FAILED'), 'Should not have READABILITY_FAILED warning');
    });

    // ── Summary ──

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n${'─'.repeat(50)}`);
    console.error(`  ${results.pass + results.fail} tests | ${results.pass} passed | ${results.fail} failed | ${elapsed}s`);

    if (results.errors.length > 0) {
      console.error(`\n  Failed tests:`);
      for (const { name, error } of results.errors) {
        console.error(`    ✖ ${name}`);
        console.error(`      ${error}`);
      }
    }

    console.error(`${'─'.repeat(50)}\n`);

    // Clean up BrowserWindows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }

    server.close();
    app.exit(results.fail > 0 ? 1 : 0);
  } catch (err) {
    console.error('[electron-e2e] Fatal error:', err);
    if (server) server.close();
    app.exit(1);
  }
});
