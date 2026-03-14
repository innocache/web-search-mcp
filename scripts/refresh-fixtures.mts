/**
 * Fixture Refresher — Layer 2 of the two-layer test strategy.
 *
 * Fetches Google Trends RSS feed, extracts trending article URLs,
 * downloads raw HTML snapshots, and generates expected.json manifests
 * with partial-match assertions for CI testing.
 *
 * Usage:
 *   node --loader ts-node/esm scripts/refresh-fixtures.mts
 *   npx tsx scripts/refresh-fixtures.mts
 *
 * Environment:
 *   TRENDS_GEO    — Google Trends geo filter (default: US)
 *   MAX_KEYWORDS  — Max trending keywords to process (default: 5)
 *   MAX_URLS      — Max URLs per keyword to snapshot (default: 2)
 *   CORPUS_DIR    — Output directory (default: tests/fixtures/corpus)
 */
import { get as httpsGet } from 'node:https';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

interface TrendItem {
  keyword: string;
  urls: string[];
  traffic: string;
}

interface SnapshotManifest {
  keyword: string;
  url: string;
  domain: string;
  fetchedAt: string;
  with: string[];
  without: string[];
  minQuality: number;
}

const TRENDS_GEO = process.env['TRENDS_GEO'] ?? 'US';
const MAX_KEYWORDS = parseInt(process.env['MAX_KEYWORDS'] ?? '5', 10);
const MAX_URLS = parseInt(process.env['MAX_URLS'] ?? '2', 10);
const CORPUS_DIR = resolve(projectRoot, process.env['CORPUS_DIR'] ?? 'tests/fixtures/corpus');

const BOILERPLATE_SUBSTRINGS = [
  'cookie',
  'subscribe',
  'newsletter',
  'privacy policy',
  'terms of service',
  'advertisement',
  'sign up',
  'follow us',
  'all rights reserved',
  'copyright',
];

function fetch(url: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpsGet(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FixtureRefresher/1.0)' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolvePromise, rejectPromise);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        rejectPromise(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
      res.on('error', rejectPromise);
    });
    req.on('error', rejectPromise);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
    const keyword = titleMatch?.[1] ?? '';
    if (!keyword) continue;

    const trafficMatch = itemXml.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
    const traffic = trafficMatch?.[1] ?? '0';

    const urls: string[] = [];
    const urlRegex = /<ht:news_item_url>(.*?)<\/ht:news_item_url>/g;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(itemXml)) !== null) {
      const url = urlMatch[1].trim();
      if (url.startsWith('http')) {
        urls.push(url);
      }
    }

    items.push({ keyword, urls: urls.slice(0, MAX_URLS), traffic });
  }

  return items.slice(0, MAX_KEYWORDS);
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

function extractTextSample(html: string): string[] {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] ?? html;
  const text = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  const meaningful = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 300)
    .filter((s) => !BOILERPLATE_SUBSTRINGS.some((b) => s.toLowerCase().includes(b)));

  return meaningful.slice(0, 5);
}

async function snapshotUrl(keyword: string, url: string): Promise<void> {
  const domain = domainFromUrl(url);
  const hash = shortHash(url);
  const dirName = `${domain}-${hash}`;
  const dirPath = resolve(CORPUS_DIR, dirName);

  await mkdir(dirPath, { recursive: true });

  console.error(`  Fetching: ${url}`);

  let html: string;
  try {
    html = await fetch(url);
  } catch (err) {
    console.error(`  SKIP (fetch error): ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (html.length < 500) {
    console.error(`  SKIP (too short: ${html.length} bytes)`);
    return;
  }

  const withPhrases = extractTextSample(html);
  if (withPhrases.length === 0) {
    console.error(`  SKIP (no meaningful text extracted)`);
    return;
  }

  const manifest: SnapshotManifest = {
    keyword,
    url,
    domain,
    fetchedAt: new Date().toISOString(),
    with: withPhrases,
    without: BOILERPLATE_SUBSTRINGS.slice(0, 5),
    minQuality: 40,
  };

  await writeFile(resolve(dirPath, 'source.html'), html, 'utf8');
  await writeFile(resolve(dirPath, 'expected.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.error(`  OK: ${dirName} (${html.length} bytes, ${withPhrases.length} assertions)`);
}

async function main(): Promise<void> {
  console.error(`[refresh-fixtures] Fetching Google Trends RSS (geo=${TRENDS_GEO})...`);

  const rssUrl = `https://trends.google.com/trending/rss?geo=${TRENDS_GEO}`;
  const xml = await fetch(rssUrl);
  const items = parseTrendsRss(xml);

  console.error(`[refresh-fixtures] Found ${items.length} trending keywords`);

  await mkdir(CORPUS_DIR, { recursive: true });

  let totalSnapshots = 0;
  for (const item of items) {
    console.error(`\nKeyword: "${item.keyword}" (~${item.traffic} searches)`);
    for (const url of item.urls) {
      await snapshotUrl(item.keyword, url);
      totalSnapshots++;
    }
  }

  console.error(`\n[refresh-fixtures] Done. ${totalSnapshots} URLs processed → ${CORPUS_DIR}`);
}

main().catch((err) => {
  console.error('[refresh-fixtures] Fatal:', err);
  process.exitCode = 1;
});
