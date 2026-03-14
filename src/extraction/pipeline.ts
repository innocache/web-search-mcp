import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';
import { parseHTML } from 'linkedom';
import { cleanHtml } from '../normalize/html.js';
import { htmlToMarkdownLite } from '../normalize/markdownLite.js';
import { normalizeText } from '../normalize/text.js';
import { buildPageSettlerScript, type WaitUntil, type PageSettleOptions } from './pageSettler.js';

interface LinkedomElement {
  tagName: string;
  nodeType: number;
  textContent: string | null;
  children: LinkedomElement[];
  childNodes: LinkedomElement[];
  parentElement: LinkedomElement | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): LinkedomElement | null;
  querySelectorAll(selector: string): LinkedomElement[];
  remove(): void;
}

interface LinkedomDocument {
  body: LinkedomElement | null;
  querySelectorAll(selector: string): LinkedomElement[];
}

interface LinkedomParseResult {
  document: LinkedomDocument;
}
import type { AppConfig } from '../util/config.js';
import { ExtractionError, wrapError } from '../util/errors.js';
import { withTimeout } from '../util/timeouts.js';
import { checkSsrf, validateUrl } from '../util/url.js';
import { Semaphore } from '../browser/browserPool.js';
import { createExtractionWindow, destroyWindow } from '../browser/windowFactory.js';
import { applyResourcePolicy } from '../browser/resourcePolicy.js';
import { BOILERPLATE_PHRASES, EXACT_REMOVE_SELECTORS, PARTIAL_REMOVE_PATTERNS, PRESERVE_RULES } from './selectorConfig.js';
import { runPostCleanup } from './postCleanup.js';
import { computeExtractionScore, getScoreLabel, isWeakExtraction } from './qualityScore.js';
import type { PreExtractionMetadata } from './metadataExtractor.js';
import type { ReadabilityArticle } from './readabilityRunner.js';

export type OutputFormat = 'text' | 'markdown' | 'html';

export interface ExtractUrlOptions {
  outputFormat: OutputFormat;
  maxChars: number;
  timeoutMs: number;
  waitUntil: WaitUntil;
  settleMs: number;
}

export interface RendererExtractionResult {
  metadata: PreExtractionMetadata;
  article: ReadabilityArticle | null;
  warnings: string[];
}

export interface StageFiveOutput {
  normalizedContent: string;
  normalizedText: string;
}

export interface ExtractionResult {
  url: string;
  finalUrl: string;
  outputFormat: OutputFormat;
  content: string;
  cleanedHtml: string;
  textContent: string;
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  language: string | null;
  author: string | null;
  description: string | null;
  publishedDate: string | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
  score: number;
  scoreLabel: string;
  weakExtraction: boolean;
  warnings: string[];
}

const semaphoreByCapacity = new Map<number, Semaphore>();
let readabilitySourcePromise: Promise<string> | null = null;

function getSemaphore(capacity: number): Semaphore {
  const normalizedCapacity = Math.max(1, capacity);
  const existing = semaphoreByCapacity.get(normalizedCapacity);
  if (existing) return existing;
  const created = new Semaphore(normalizedCapacity);
  semaphoreByCapacity.set(normalizedCapacity, created);
  return created;
}

function getReadabilitySourcePath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, '..', '..', 'vendor', 'Readability.js');
}

async function getReadabilitySource(): Promise<string> {
  if (!readabilitySourcePromise) {
    readabilitySourcePromise = readFile(getReadabilitySourcePath(), 'utf8');
  }
  return readabilitySourcePromise;
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Convert cleaned HTML to plain text while preserving paragraph structure.
 * Inserts double newlines between block-level elements so the output isn't
 * a wall of text. Handles <br> as single newline.
 */
export function plainTextFromHtml(html: string): string {
  if (!html || html.trim().length === 0) return '';
  const wrapped = /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped) as unknown as LinkedomParseResult;
  if (!document.body) return '';

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI',
    'TABLE', 'TR', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'HR',
  ]);

  const parts: string[] = [];

  function walk(node: LinkedomElement): void {
    if (node.nodeType === 3) {
      // Text node
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (text.length > 0) parts.push(text);
      return;
    }

    if (node.nodeType !== 1) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    if (tag === 'HR') {
      parts.push('\n\n');
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n\n');

    for (const child of Array.from(node.childNodes) as LinkedomElement[]) {
      walk(child);
    }

    if (isBlock) parts.push('\n\n');
  }

  walk(document.body as unknown as LinkedomElement);

  // Collapse excessive newlines while preserving paragraph breaks
  return parts.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n');
}

export function runNormalizeStage(html: string, outputFormat: OutputFormat, maxChars: number): StageFiveOutput {
  const sourceText = plainTextFromHtml(html);
  const normalizedText = normalizeText(sourceText, maxChars);

  if (outputFormat === 'html') {
    return {
      normalizedContent: cleanHtml(html, maxChars),
      normalizedText,
    };
  }

  if (outputFormat === 'markdown') {
    return {
      normalizedContent: htmlToMarkdownLite(html, maxChars),
      normalizedText,
    };
  }

  return {
    normalizedContent: normalizedText,
    normalizedText,
  };
}

export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?:\s|$)/g);
  return matches ? matches.length : 0;
}

export function computeLinkDensity(html: string): number {
  if (!html || html.trim().length === 0) return 0;
  const wrapped = /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped) as unknown as LinkedomParseResult;
  const totalText = normalizeWhitespace(document.body?.textContent ?? '');
  if (totalText.length === 0) return 0;
  const linkedTextLength = (Array.from(document.querySelectorAll('a')) as LinkedomElement[]).reduce((sum: number, anchor: LinkedomElement) => {
    return sum + normalizeWhitespace(anchor.textContent ?? '').length;
  }, 0);
  return Math.min(1, linkedTextLength / totalText.length);
}

export function countBoilerplateHits(text: string): number {
  let hits = 0;
  for (const pattern of BOILERPLATE_PHRASES) {
    if (pattern.test(text)) hits++;
  }
  return hits;
}

export function buildRendererScript(readabilitySource: string): string {
  const exactSelectors = JSON.stringify(EXACT_REMOVE_SELECTORS);
  const partialPatterns = JSON.stringify(PARTIAL_REMOVE_PATTERNS.map((pattern) => pattern.toLowerCase()));
  const preserveRules = JSON.stringify(PRESERVE_RULES);

  return [
    '(() => {',
    readabilitySource,
    `
const EXACT_REMOVE_SELECTORS = ${exactSelectors};
const PARTIAL_REMOVE_PATTERNS = ${partialPatterns};
const PRESERVE_RULES = ${preserveRules};

function cleanString(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.replace(/\\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function readMetaContent(selector) {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLMetaElement)) return null;
  return cleanString(node.getAttribute('content'));
}

function valueFromUnknown(input) {
  return typeof input === 'string' ? cleanString(input) : null;
}

function imageFromUnknown(input) {
  if (typeof input === 'string') return cleanString(input);
  if (Array.isArray(input)) {
    for (const item of input) {
      const candidate = imageFromUnknown(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof input === 'object' && input !== null) {
    return valueFromUnknown(input.url) || valueFromUnknown(input.contentUrl);
  }
  return null;
}

function authorFromUnknown(input) {
  if (typeof input === 'string') return cleanString(input);
  if (Array.isArray(input)) {
    for (const item of input) {
      const candidate = authorFromUnknown(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof input === 'object' && input !== null) {
    return valueFromUnknown(input.name) || valueFromUnknown(input.alternateName);
  }
  return null;
}

function extractSignalFromNode(node) {
  if (!node || typeof node !== 'object') {
    return {
      title: null,
      description: null,
      author: null,
      siteName: null,
      publishedDate: null,
      imageUrl: null,
    };
  }

  const publisher = node.publisher && typeof node.publisher === 'object' ? node.publisher : null;

  return {
    title: valueFromUnknown(node.headline) || valueFromUnknown(node.name),
    description: valueFromUnknown(node.description),
    author: authorFromUnknown(node.author),
    siteName: valueFromUnknown(publisher && publisher.name),
    publishedDate: valueFromUnknown(node.datePublished) || valueFromUnknown(node.dateCreated) || valueFromUnknown(node.uploadDate),
    imageUrl: imageFromUnknown(node.image),
  };
}

function extractMetadata() {
  const aggregate = {
    title: null,
    description: null,
    author: null,
    siteName: null,
    publishedDate: null,
    imageUrl: null,
    canonicalUrl: null,
    language: cleanString(document.documentElement.getAttribute('lang')),
  };

  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    const text = script.textContent;
    if (!text || !text.trim()) continue;
    try {
      const parsed = JSON.parse(text);
      const nodes = [];
      if (Array.isArray(parsed)) {
        nodes.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed['@graph'])) {
          nodes.push(...parsed['@graph']);
        }
        nodes.push(parsed);
      }

      for (const node of nodes) {
        const signal = extractSignalFromNode(node);
        aggregate.title = aggregate.title || signal.title;
        aggregate.description = aggregate.description || signal.description;
        aggregate.author = aggregate.author || signal.author;
        aggregate.siteName = aggregate.siteName || signal.siteName;
        aggregate.publishedDate = aggregate.publishedDate || signal.publishedDate;
        aggregate.imageUrl = aggregate.imageUrl || signal.imageUrl;
      }
    } catch {
      continue;
    }
  }

  const ogTitle = readMetaContent('meta[property="og:title"]');
  const ogDescription = readMetaContent('meta[property="og:description"]');
  const ogImage = readMetaContent('meta[property="og:image"]') || readMetaContent('meta[name="twitter:image"]');
  const ogSiteName = readMetaContent('meta[property="og:site_name"]');
  const ogPublished = readMetaContent('meta[property="article:published_time"]') || readMetaContent('meta[name="article:published_time"]');
  const metaAuthor = readMetaContent('meta[name="author"]') || readMetaContent('meta[property="author"]');
  const metaDescription = readMetaContent('meta[name="description"]') || readMetaContent('meta[property="description"]') || readMetaContent('meta[name="twitter:description"]');

  const canonicalNode = document.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalNode instanceof HTMLLinkElement ? cleanString(canonicalNode.getAttribute('href')) : null;
  const titleTag = cleanString(document.querySelector('title') ? document.querySelector('title').textContent : document.title);

  return {
    title: ogTitle || aggregate.title || titleTag,
    description: ogDescription || metaDescription || aggregate.description,
    author: metaAuthor || aggregate.author,
    siteName: ogSiteName || aggregate.siteName,
    publishedDate: ogPublished || aggregate.publishedDate,
    imageUrl: ogImage || aggregate.imageUrl,
    canonicalUrl,
    language: aggregate.language,
  };
}

function isMarked(node) {
  return node.hasAttribute('data-preserve') || node.hasAttribute('data-has-preserve');
}

function markPreserve() {
  for (const selector of PRESERVE_RULES) {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      nodes = [];
    }

    for (const node of nodes) {
      node.setAttribute('data-preserve', 'true');
      let current = node.parentElement;
      while (current) {
        current.setAttribute('data-has-preserve', 'true');
        current = current.parentElement;
      }
    }
  }
}

function removeSafe(selector) {
  let nodes = [];
  try {
    nodes = Array.from(document.querySelectorAll(selector));
  } catch {
    nodes = [];
  }
  for (const node of nodes) {
    if (isMarked(node)) continue;
    node.remove();
  }
}

function runDomCleanup() {
  markPreserve();

  for (const selector of EXACT_REMOVE_SELECTORS) {
    removeSafe(selector);
  }

  for (const node of Array.from(document.querySelectorAll('*'))) {
    if (isMarked(node)) continue;
    const tokenText = ((node.getAttribute('class') || '') + ' ' + (node.getAttribute('id') || '')).toLowerCase();
    for (const pattern of PARTIAL_REMOVE_PATTERNS) {
      if (tokenText.includes(pattern)) {
        node.remove();
        break;
      }
    }
  }

  for (const node of Array.from(document.querySelectorAll('*'))) {
    if (isMarked(node)) continue;
    const style = getComputedStyle(node);
    const ariaHidden = (node.getAttribute('aria-hidden') || '').toLowerCase() === 'true';
    if (ariaHidden || node.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden') {
      node.remove();
    }
  }

  for (const image of Array.from(document.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    const lazy = image.getAttribute('data-src') || image.getAttribute('data-lazy-src');
    if (!src && lazy) {
      image.setAttribute('src', lazy);
    }
  }

  for (const svg of Array.from(document.querySelectorAll('svg'))) {
    if (isMarked(svg)) continue;
    if (svg.closest('figure')) continue;
    if ((svg.getAttribute('role') || '').toLowerCase() === 'img') continue;
    svg.remove();
  }

  let removed = true;
  while (removed) {
    removed = false;
    for (const node of Array.from(document.querySelectorAll('div,section,span'))) {
      if (isMarked(node)) continue;
      const text = (node.textContent || '').trim();
      if (text.length === 0 && node.children.length === 0) {
        node.remove();
        removed = true;
      }
    }
  }

  for (const node of Array.from(document.querySelectorAll('[data-preserve],[data-has-preserve]'))) {
    node.removeAttribute('data-preserve');
    node.removeAttribute('data-has-preserve');
  }
}

function runReadability() {
  const warnings = [];
  const Readability = window.__Readability;
  const isProbablyReaderable = window.__isProbablyReaderable;

  if (typeof Readability !== 'function' || typeof isProbablyReaderable !== 'function') {
    warnings.push('READABILITY_FAILED');
    return { article: null, warnings };
  }

  if (!isProbablyReaderable(document)) {
    warnings.push('READABILITY_UNCERTAIN');
  }

  const clone = document.cloneNode(true);
  if (!(clone instanceof Document)) {
    warnings.push('READABILITY_FAILED');
    return { article: null, warnings };
  }

  const article = new Readability(clone).parse();
  if (!article) {
    warnings.push('READABILITY_FAILED');
    return { article: null, warnings };
  }

  return {
    article: {
      title: typeof article.title === 'string' ? article.title : '',
      byline: typeof article.byline === 'string' ? article.byline : null,
      excerpt: typeof article.excerpt === 'string' ? article.excerpt : null,
      siteName: typeof article.siteName === 'string' ? article.siteName : null,
      content: typeof article.content === 'string' ? article.content : '',
      textContent: typeof article.textContent === 'string' ? article.textContent : '',
      length: typeof article.length === 'number' ? article.length : 0,
      lang: typeof article.lang === 'string' ? article.lang : null,
    },
    warnings,
  };
}

const metadata = extractMetadata();
runDomCleanup();
const readability = runReadability();

return {
  metadata,
  article: readability.article,
  warnings: readability.warnings,
};
`,
    '})();',
  ].join('\n');
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

export function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

export function parseMetadata(value: unknown): PreExtractionMetadata {
  const record = asRecord(value);

  return {
    title: toStringOrNull(record?.title),
    description: toStringOrNull(record?.description),
    author: toStringOrNull(record?.author),
    siteName: toStringOrNull(record?.siteName),
    publishedDate: toStringOrNull(record?.publishedDate),
    imageUrl: toStringOrNull(record?.imageUrl),
    canonicalUrl: toStringOrNull(record?.canonicalUrl),
    language: toStringOrNull(record?.language),
  };
}

export function parseArticle(value: unknown): ReadabilityArticle | null {
  const record = asRecord(value);
  if (!record) return null;

  const content = toStringOrNull(record.content) ?? '';
  const textContent = toStringOrNull(record.textContent) ?? '';
  if (content.length === 0 && textContent.length === 0) {
    return null;
  }

  const lengthValue = typeof record.length === 'number' && Number.isFinite(record.length) ? record.length : textContent.length;

  return {
    title: toStringOrNull(record.title) ?? '',
    byline: toStringOrNull(record.byline),
    excerpt: toStringOrNull(record.excerpt),
    siteName: toStringOrNull(record.siteName),
    content,
    textContent,
    length: Math.max(0, lengthValue),
    lang: toStringOrNull(record.lang),
  };
}

export function parseWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function parseRendererResult(value: unknown): RendererExtractionResult {
  const record = asRecord(value);
  if (!record) {
    return {
      metadata: {
        title: null,
        description: null,
        author: null,
        siteName: null,
        publishedDate: null,
        imageUrl: null,
        canonicalUrl: null,
        language: null,
      },
      article: null,
      warnings: ['READABILITY_FAILED'],
    };
  }

  return {
    metadata: parseMetadata(record.metadata),
    article: parseArticle(record.article),
    warnings: parseWarnings(record.warnings),
  };
}

async function waitForDidFinishLoad(win: BrowserWindow, url: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const cleanup = (): void => {
      if (win.isDestroyed()) return;
      win.webContents.removeListener('did-finish-load', onFinish);
      win.webContents.removeListener('did-fail-load', onFail);
    };

    const onFinish = (): void => {
      cleanup();
      resolvePromise();
    };

    const onFail = (...args: unknown[]): void => {
      const errorCode = typeof args[1] === 'number' ? args[1] : -1;
      const errorDescription = typeof args[2] === 'string' ? args[2] : 'Unknown load failure';
      const failingUrl = typeof args[3] === 'string' ? args[3] : url;
      const isMainFrame = typeof args[4] === 'boolean' ? args[4] : true;
      if (!isMainFrame) return;

      cleanup();
      rejectPromise(
        new ExtractionError(
          'NAVIGATION_FAILED',
          `Failed to load ${failingUrl}: ${errorDescription} (${errorCode})`,
        ),
      );
    };

    win.webContents.once('did-finish-load', onFinish);
    win.webContents.on('did-fail-load', onFail);

    void win.loadURL(url).catch((error: unknown) => {
      cleanup();
      rejectPromise(new ExtractionError('NAVIGATION_FAILED', `Navigation failed for ${url}`, error));
    });
  });
}

async function waitForDomReady(win: BrowserWindow, url: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const cleanup = (): void => {
      if (win.isDestroyed()) return;
      win.webContents.removeListener('dom-ready', onReady);
      win.webContents.removeListener('did-fail-load', onFail);
    };

    const onReady = (): void => {
      cleanup();
      resolvePromise();
    };

    const onFail = (...args: unknown[]): void => {
      const errorCode = typeof args[1] === 'number' ? args[1] : -1;
      const errorDescription = typeof args[2] === 'string' ? args[2] : 'Unknown load failure';
      const failingUrl = typeof args[3] === 'string' ? args[3] : url;
      const isMainFrame = typeof args[4] === 'boolean' ? args[4] : true;
      if (!isMainFrame) return;

      cleanup();
      rejectPromise(
        new ExtractionError(
          'NAVIGATION_FAILED',
          `Failed to load ${failingUrl}: ${errorDescription} (${errorCode})`,
        ),
      );
    };

    win.webContents.once('dom-ready', onReady);
    win.webContents.on('did-fail-load', onFail);

    void win.loadURL(url).catch((error: unknown) => {
      cleanup();
      rejectPromise(new ExtractionError('NAVIGATION_FAILED', `Navigation failed for ${url}`, error));
    });
  });
}

async function waitForLoadEvent(win: BrowserWindow, url: string, waitUntil: WaitUntil): Promise<void> {
  if (waitUntil === 'domcontentloaded' || waitUntil === 'network-idle-like') {
    await waitForDomReady(win, url);
  } else {
    await waitForDidFinishLoad(win, url);
  }
}

async function runExtraction(url: string, config: AppConfig, options: ExtractUrlOptions): Promise<ExtractionResult> {
  const parsedUrl = validateUrl(url);
  checkSsrf(parsedUrl.hostname);

  const semaphore = getSemaphore(config.browserConcurrency);
  await semaphore.acquire();

  const readabilitySource = await getReadabilitySource();
  const script = buildRendererScript(readabilitySource);
  let win: BrowserWindow | null = null;

  try {
    win = createExtractionWindow(config);
    applyResourcePolicy(win, config);

    await waitForLoadEvent(win, parsedUrl.toString(), options.waitUntil);

    const maxSettleBudget = Math.max(0, options.timeoutMs - 2500);
    const effectiveSettleMs = Math.min(options.settleMs, maxSettleBudget);

    if (effectiveSettleMs > 0) {
      const isNetworkIdle = options.waitUntil === 'network-idle-like';
      const settleOpts: PageSettleOptions = {
        mode: options.waitUntil,
        maxWaitMs: effectiveSettleMs,
        stabilityMs: isNetworkIdle ? 600 : 300,
        pollIntervalMs: 100,
        minTextLength: isNetworkIdle ? 500 : 200,
        fastPathThreshold: 3000,
        idleMs: 500,
        minWaitMs: isNetworkIdle ? 1000 : 0,
      };
      const settleScript = buildPageSettlerScript(settleOpts);
      await win.webContents.executeJavaScript(settleScript, true);
    }

    const rendererRaw = await win.webContents.executeJavaScript(script, true);
    const rendererResult = parseRendererResult(rendererRaw);

    const originalHtml = rendererResult.article?.content ?? '';
    const postCleanup = runPostCleanup(originalHtml);
    const stageFive = runNormalizeStage(postCleanup.cleanedHtml, options.outputFormat, options.maxChars);

    const title = rendererResult.article?.title || rendererResult.metadata.title;
    const byline = rendererResult.article?.byline ?? null;
    const excerpt = rendererResult.article?.excerpt ?? null;
    const siteName = rendererResult.article?.siteName ?? rendererResult.metadata.siteName;
    const language = rendererResult.article?.lang ?? rendererResult.metadata.language;

    const linkDensity = computeLinkDensity(postCleanup.cleanedHtml);
    const boilerplateHits = countBoilerplateHits(stageFive.normalizedText);
    const sentenceCount = countSentences(stageFive.normalizedText);
    const score = computeExtractionScore({
      textLength: stageFive.normalizedText.length,
      sentenceCount,
      linkDensity,
      boilerplateHits,
      hasTitle: Boolean(title),
      hasByline: Boolean(byline),
      hasExcerpt: Boolean(excerpt),
      hasDate: Boolean(rendererResult.metadata.publishedDate),
      readabilitySucceeded: Boolean(rendererResult.article),
    });

    const warnings = [...rendererResult.warnings, ...postCleanup.warnings];
    if (stageFive.normalizedText.length === 0) {
      warnings.push('READABILITY_EMPTY');
    }

    const uniqueWarnings = Array.from(new Set(warnings));

    if (stageFive.normalizedText.length === 0) {
      throw new ExtractionError('READABILITY_EMPTY', `No extractable content for ${url}`);
    }

    return {
      url,
      finalUrl: win.webContents.getURL(),
      outputFormat: options.outputFormat,
      content: stageFive.normalizedContent,
      cleanedHtml: postCleanup.cleanedHtml,
      textContent: stageFive.normalizedText,
      title,
      byline,
      excerpt,
      siteName,
      language,
      author: rendererResult.metadata.author,
      description: rendererResult.metadata.description,
      publishedDate: rendererResult.metadata.publishedDate,
      imageUrl: rendererResult.metadata.imageUrl,
      canonicalUrl: rendererResult.metadata.canonicalUrl,
      score,
      scoreLabel: getScoreLabel(score),
      weakExtraction: isWeakExtraction(score, stageFive.normalizedText.length, linkDensity),
      warnings: uniqueWarnings,
    };
  } finally {
    await destroyWindow(win);
    semaphore.release();
  }
}

export async function extractUrl(
  url: string,
  config: AppConfig,
  options: ExtractUrlOptions,
): Promise<ExtractionResult> {
  try {
    return await withTimeout(
      runExtraction(url, config, options),
      options.timeoutMs,
      `Timed out extracting ${url}`,
    );
  } catch (error) {
    throw wrapError(error);
  }
}
