/**
 * Quality audit — Electron main process script.
 *
 * Extracts a diverse set of real-world URLs and dumps detailed diagnostics:
 *   - Extracted text (first 2000 chars)
 *   - Cleaned HTML (first 2000 chars)
 *   - Quality score + components
 *   - Noise indicators (boilerplate phrases found, link density, nav/ad remnants)
 *   - Warnings
 *
 * Run via: npx tsx scripts/run-quality-audit.mts
 */

import { app, BrowserWindow } from 'electron';
import { resolve, dirname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

app.commandLine.appendSwitch('no-sandbox');
// Allow self-signed / untrusted certs in audit mode (not production).
// Without this, many sites fail with ERR_CERT_AUTHORITY_INVALID because
// Electron's bundled Chromium doesn't always trust the system cert store.
app.commandLine.appendSwitch('ignore-certificate-errors');
app.on('window-all-closed', (e) => e.preventDefault());

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

// Diverse URL set: news articles, blogs, technical docs, wikis, SPA content
// Selected for stability — these are permalink/evergreen URLs unlikely to 404.
//
// Split into two tiers per Oracle recommendation:
//   Tier A: "Expected to work" — public pages, no login/age gate, not DNS-blocked.
//           Pass rate is measured against this tier.
//   Tier B: "Known restricted" — age gates, paywalls, DNS-blocked.
//           Reported qualitatively, not counted against pass rate.
const AUDIT_URLS = [
  // ── Tier A: Expected to work ──
  // Major news outlets — stable article permalinks
  { url: 'https://www.reuters.com/technology/artificial-intelligence/', category: 'news-index', note: 'Index/hub page — should extract poorly or identify as non-article', tier: 'A' },
  { url: 'https://apnews.com/article/pi-day-celebrates-science-math-549286e6ea0a093cbc75f3b17fdc150f', category: 'news-article', note: 'AP News article — CSR-heavy', tier: 'A', overrides: { waitUntil: 'network-idle-like', settleMs: 6000 } },
  { url: 'https://www.bbc.com/news/technology-65855333', category: 'news-article', note: 'BBC News — well-structured, minimal ads', tier: 'A' },
  // Tech blogs / docs
  { url: 'https://github.blog/engineering/the-technology-behind-githubs-new-code-search/', category: 'tech-blog', note: 'GitHub engineering blog — long-form technical', tier: 'A' },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise', category: 'docs', note: 'MDN reference page — structured docs with code blocks', tier: 'A' },
  // Wikipedia
  { url: 'https://en.wikipedia.org/wiki/Large_language_model', category: 'wiki', note: 'Wikipedia — dense content, citations, tables, infoboxes', tier: 'A' },
  // Newsletter / blog
  { url: 'https://paulgraham.com/writes.html', category: 'blog', note: 'Paul Graham essay — plain HTML, minimal styling', tier: 'A' },
  // Complex layouts
  { url: 'https://www.nytimes.com/', category: 'homepage', note: 'NYT homepage — should extract poorly (not an article)', tier: 'A' },
  // CSR-heavy / SPA sites
  { url: 'https://dev.to/sylwia-lask/the-real-skill-in-programming-is-debugging-everything-else-is-copy-paste-i39', category: 'dev-blog', note: 'Dev.to article — Preact SPA, substantial article content', tier: 'A', overrides: { waitUntil: 'network-idle-like', settleMs: 4000 } },
  { url: 'https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development', category: 'substack', note: 'Pragmatic Engineer Substack — React SPA, long-form technical', tier: 'A', overrides: { waitUntil: 'network-idle-like', settleMs: 6000 } },

  // Reddit & Medium — CSR-heavy platforms (user-provided URLs)
  { url: 'https://www.reddit.com/r/LocalLLaMA/comments/1rpw17y/ryzen_ai_max_395_128gb_qwen_35_35b122b_benchmarks/', category: 'forum', note: 'Reddit post — CSR React SPA with comments', tier: 'A', overrides: { waitUntil: 'network-idle-like', settleMs: 8000 } },
  { url: 'https://freedium-mirror.cfd/https://medium.com/@GenerationAI/qwen-image-edit-on-amd-ryzen-ai-max-395-strix-halo-intel-core-ultra-125h-24ebd8809d74', category: 'blog-platform', note: 'Medium article via Freedium mirror — bypasses paywall/bot detection', tier: 'A', overrides: { waitUntil: 'network-idle-like', settleMs: 8000 } },

  // ── Tier B: Known restricted (not counted against pass rate) ──
  { url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array', category: 'qa', note: 'Stack Overflow — DNS-blocked by OpenDNS on this network', tier: 'B' },
  { url: 'https://www.washingtonpost.com/politics/', category: 'news-index', note: 'WaPo politics — paywall + heavy JS', tier: 'B', overrides: { waitUntil: 'network-idle-like', settleMs: 5000 } },
];

const NOISE_PATTERNS = [
  /cookie\s*(policy|consent|settings|preferences)/i,
  /accept\s*(all\s*)?cookies/i,
  /subscribe\s*(now|today|to\s*(our|the))/i,
  /sign\s*up\s*(for|to)/i,
  /newsletter/i,
  /privacy\s*policy/i,
  /terms\s*(of\s*service|of\s*use|\s*&\s*conditions)/i,
  /all\s*rights\s*reserved/i,
  /advertisement|sponsored\s*content/i,
  /follow\s*us\s*(on|at)/i,
  /share\s*(this|on)\s*(twitter|x|facebook|linkedin)/i,
  /read\s*more\s*:/i,
  /related\s*(articles?|stories|posts)/i,
  /recommended\s*(for\s*you|stories)/i,
  /most\s*(popular|read|viewed)/i,
  /©\s*\d{4}/,
  /click\s*here/i,
  /skip\s*to\s*(main\s*)?content/i,
  /back\s*to\s*top/i,
  /log\s*in|sign\s*in/i,
  /create\s*(an?\s*)?account/i,
];

function detectNoise(text) {
  const hits = [];
  for (const pattern of NOISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const idx = match.index ?? 0;
      const context = text.slice(Math.max(0, idx - 40), idx + match[0].length + 40).replace(/\n/g, ' ');
      hits.push({ pattern: pattern.source, matched: match[0], context });
    }
  }
  return hits;
}

function countParagraphs(text) {
  return text.split(/\n\n+/).filter(p => p.trim().length > 50).length;
}

function avgSentenceLength(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0);
  return Math.round(totalWords / sentences.length);
}

app.whenReady().then(async () => {
  console.error('[quality-audit] Electron ready');

  const keepalive = new BrowserWindow({ show: false, width: 1, height: 1 });

  const { extractUrl } = await import(resolve(projectRoot, 'dist', 'extraction', 'pipeline.js'));
  const { loadConfig } = await import(resolve(projectRoot, 'dist', 'util', 'config.js'));

  const config = {
    ...loadConfig(),
    headlessMode: true,
    resourceBlockImages: true,
    resourceBlockMedia: true,
    resourceBlockFonts: true,
    defaultTimeoutMs: 45000,
    defaultSettleMs: 1500,
    maxCharsDefault: 80000,
    browserConcurrency: 1,
  };

  const defaultOptions = {
    outputFormat: 'text',
    maxChars: 80000,
    timeoutMs: 45000,
    waitUntil: 'load',
    settleMs: 1200,
  };

  const auditResults = [];

  for (const { url, category, note, overrides, tier } of AUDIT_URLS) {
    console.error(`\n${'═'.repeat(70)}`);
    console.error(`  URL: ${url}`);
    console.error(`  Category: ${category} | ${note}`);
    console.error(`${'═'.repeat(70)}`);

    const entry = { url, category, note, tier, success: false, result: null, error: null, diagnostics: null };

    try {
      const opts = overrides ? { ...defaultOptions, ...overrides } : defaultOptions;
      const result = await extractUrl(url, config, opts);
      entry.success = true;

      const noiseHits = detectNoise(result.textContent);
      const paragraphs = countParagraphs(result.textContent);
      const avgSentLen = avgSentenceLength(result.textContent);

      const diagnostics = {
        textLength: result.textContent.length,
        paragraphs,
        avgSentenceLength: avgSentLen,
        score: result.score,
        scoreLabel: result.scoreLabel,
        weakExtraction: result.weakExtraction,
        warnings: result.warnings,
        title: result.title,
        byline: result.byline,
        author: result.author,
        excerpt: result.excerpt?.slice(0, 200),
        siteName: result.siteName,
        publishedDate: result.publishedDate,
        noiseHits: noiseHits.length,
        noiseDetails: noiseHits,
        cleanedHtmlLength: result.cleanedHtml.length,
      };

      entry.diagnostics = diagnostics;

      console.error(`\n  ── Metadata ──`);
      console.error(`  Title:    ${result.title || '(none)'}`);
      console.error(`  Author:   ${result.author || result.byline || '(none)'}`);
      console.error(`  Date:     ${result.publishedDate || '(none)'}`);
      console.error(`  Site:     ${result.siteName || '(none)'}`);

      console.error(`\n  ── Quality ──`);
      console.error(`  Score:    ${result.score} (${result.scoreLabel})`);
      console.error(`  Weak:     ${result.weakExtraction}`);
      console.error(`  Warnings: ${result.warnings.join(', ') || '(none)'}`);

      console.error(`\n  ── Content Stats ──`);
      console.error(`  Text length:    ${result.textContent.length} chars`);
      console.error(`  HTML length:    ${result.cleanedHtml.length} chars`);
      console.error(`  Paragraphs:     ${paragraphs}`);
      console.error(`  Avg sent len:   ${avgSentLen} words`);

      console.error(`\n  ── Noise Detection (${noiseHits.length} hits) ──`);
      if (noiseHits.length > 0) {
        for (const hit of noiseHits) {
          console.error(`    ⚠ "${hit.matched}" — ...${hit.context}...`);
        }
      } else {
        console.error(`    ✔ No boilerplate noise detected`);
      }

      console.error(`\n  ── First 1500 chars of extracted text ──`);
      console.error(result.textContent.slice(0, 1500).split('\n').map(l => `    ${l}`).join('\n'));

      if (result.textContent.length > 1500) {
        console.error(`\n  ── Last 500 chars of extracted text ──`);
        console.error(result.textContent.slice(-500).split('\n').map(l => `    ${l}`).join('\n'));
      }
    } catch (err) {
      entry.error = err.message || String(err);
      console.error(`  ✖ EXTRACTION FAILED: ${entry.error}`);
    }

    auditResults.push(entry);

    // Delay between extractions
    await new Promise(r => setTimeout(r, 1500));
  }

  // Write JSON report
  const reportDir = resolve(projectRoot, 'tests', 'fixtures', 'audit');
  await mkdir(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `audit-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(reportPath, JSON.stringify(auditResults, null, 2), 'utf8');
  console.error(`\n[quality-audit] Report written to ${reportPath}`);

  // Summary — tier-based reporting
  console.error(`\n${'═'.repeat(70)}`);
  console.error('  QUALITY AUDIT SUMMARY');
  console.error(`${'═'.repeat(70)}`);
  const tierA = auditResults.filter(r => r.tier === 'A');
  const tierB = auditResults.filter(r => r.tier === 'B');
  const tierASucceeded = tierA.filter(r => r.success);
  const tierAFailed = tierA.filter(r => !r.success);
  const tierAGood = tierASucceeded.filter(r => r.diagnostics?.score >= 65 && r.diagnostics?.noiseHits === 0);
  const tierANoisy = tierASucceeded.filter(r => r.diagnostics?.noiseHits > 0);
  const tierAWeak = tierASucceeded.filter(r => r.diagnostics?.weakExtraction);

  console.error(`\n  ── Tier A: Expected to work (${tierA.length} URLs) ──`);
  console.error(`  Extracted OK:     ${tierASucceeded.length}/${tierA.length}`);
  console.error(`  Good quality:     ${tierAGood.length} (score≥65, no noise)`);
  console.error(`  Noisy:            ${tierANoisy.length}`);
  console.error(`  Weak:             ${tierAWeak.length}`);
  console.error(`  Failed:           ${tierAFailed.length}`);
  console.error(`  Pass rate:        ${tierA.length > 0 ? Math.round((tierAGood.length / tierA.length) * 100) : 0}%`);

  if (tierANoisy.length > 0) {
    console.error(`\n  Tier A noisy extractions:`);
    for (const r of tierANoisy) {
      console.error(`    • ${r.url} — ${r.diagnostics.noiseHits} noise hit(s), score=${r.diagnostics.score}`);
    }
  }

  if (tierAFailed.length > 0) {
    console.error(`\n  Tier A failed extractions:`);
    for (const r of tierAFailed) {
      console.error(`    • ${r.url} — ${r.error}`);
    }
  }

  if (tierB.length > 0) {
    const tierBSucceeded = tierB.filter(r => r.success);
    console.error(`\n  ── Tier B: Known restricted (${tierB.length} URLs, not in pass rate) ──`);
    console.error(`  Extracted OK:     ${tierBSucceeded.length}/${tierB.length}`);
    for (const r of tierB) {
      const status = r.success ? `✔ score=${r.diagnostics?.score}` : `✖ ${r.error}`;
      console.error(`    • ${r.url} — ${status}`);
    }
  }
  console.error(`${'═'.repeat(70)}\n`);

  // Clean up
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }

  app.exit(0);
});
