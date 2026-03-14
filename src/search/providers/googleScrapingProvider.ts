import type { BrowserWindow } from 'electron';
import type { SearchProvider } from '../SearchProvider.js';
import type { AppConfig } from '../../util/config.js';
import { ExtractionError } from '../../util/errors.js';
import { withSerpWindow } from '../../browser/serpWindow.js';
import { withTimeout } from '../../util/timeouts.js';
import type { RawSerpResult, SearchInput, SearchResult } from '../models.js';

interface SerpExecutionResult {
  blockedReason: string | null;
  results: RawSerpResult[];
}

const MIN_SETTLE_MS = 500;
const MAX_SETTLE_MS = 1000;

function waitForDidFinishLoad(win: BrowserWindow): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onDidFinishLoad = (): void => {
      cleanup();
      resolve();
    };

    const onDidFailLoad = (_event: unknown, code: number, description: string): void => {
      cleanup();
      reject(
        new ExtractionError(
          'NAVIGATION_FAILED',
          `Failed to load Google SERP (code ${code}): ${description}`,
        ),
      );
    };

    const cleanup = (): void => {
      win.webContents.removeListener('did-finish-load', onDidFinishLoad);
      win.webContents.removeListener('did-fail-load', onDidFailLoad);
    };

    win.webContents.once('did-finish-load', onDidFinishLoad);
    win.webContents.once('did-fail-load', onDidFailLoad);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampSettleMs(ms: number): number {
  return Math.min(MAX_SETTLE_MS, Math.max(MIN_SETTLE_MS, ms));
}

function createGoogleSerpScript(): string {
  return `(() => {
    const BLOCK_TEXT_PATTERNS = [
      'unusual traffic',
      'not a robot',
      'automated queries',
      'our systems have detected',
      'complete the captcha',
      'verify you are human',
      'recaptcha'
    ];

    const AD_BADGE_TEXT = new Set(['ad', 'ads', 'sponsored']);

    const normalizeText = (value) => value.replace(/\\s+/g, ' ').trim();

    const unwrapGoogleRedirect = (href) => {
      try {
        const url = new URL(href, 'https://www.google.com');
        if (url.pathname === '/url') {
          const q = url.searchParams.get('q') || url.searchParams.get('url');
          if (q) return q;
        }
      } catch {
      }
      return href;
    };

    const isHttpUrl = (href) => {
      try {
        const parsed = new URL(href);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    };

    const isGoogleChromeUrl = (href) => {
      try {
        const parsed = new URL(href);
        if (!parsed.hostname.includes('google.')) {
          return false;
        }
        return [
          '/search',
          '/preferences',
          '/advanced_search',
          '/setprefs',
          '/sorry',
          '/policies'
        ].some((path) => parsed.pathname.startsWith(path));
      } catch {
        return true;
      }
    };

    const nearestContainer = (anchor) => (
      anchor.closest('article, li, div, section') || anchor.parentElement || anchor
    );

    const extractDisplayUrl = (anchor) => {
      const container = nearestContainer(anchor);
      const cite = container.querySelector('cite') ||
        (container.parentElement ? container.parentElement.querySelector('cite') : null);
      const text = cite ? normalizeText(cite.textContent || '') : '';
      return text || undefined;
    };

    const collectTextCandidates = (container) => {
      const results = [];
      const candidates = container.querySelectorAll('span, div');
      for (const candidate of candidates) {
        if (candidate.querySelector('h3, cite, a, script, style, noscript')) {
          continue;
        }
        const text = normalizeText(candidate.textContent || '');
        if (text.length >= 30) {
          results.push(text);
        }
      }
      return results;
    };

    const extractSnippet = (anchor) => {
      const container = nearestContainer(anchor);
      const candidates = [];
      if (anchor.parentElement && anchor.parentElement.nextElementSibling) {
        candidates.push(...collectTextCandidates(anchor.parentElement.nextElementSibling));
      }
      if (container.nextElementSibling) {
        candidates.push(...collectTextCandidates(container.nextElementSibling));
      }
      candidates.push(...collectTextCandidates(container));
      return candidates.find((text) => text.length >= 40 && text.length <= 360);
    };

    const isAdResult = (anchor) => {
      const container = nearestContainer(anchor);
      const sponsoredAria = container.querySelector(
        '[aria-label*="sponsored" i], [aria-label="ad" i], [aria-label="ads" i]'
      );
      if (sponsoredAria) {
        return true;
      }

      const badgeElements = container.querySelectorAll('span, div, label');
      for (const badge of badgeElements) {
        const text = normalizeText(badge.textContent || '').toLowerCase();
        if (text.length > 0 && text.length <= 14 && AD_BADGE_TEXT.has(text)) {
          return true;
        }
      }

      return false;
    };

    const detectSerpBlock = () => {
      const locationHref = document.location.href.toLowerCase();
      if (locationHref.includes('/sorry/')) {
        return 'Google returned a /sorry/ anti-bot page';
      }

      if (document.querySelector('iframe[src*="recaptcha" i], script[src*="recaptcha" i]')) {
        return 'Google reCAPTCHA challenge detected';
      }

      if (document.querySelector('input[name="captcha" i], form[action*="sorry" i]')) {
        return 'Google CAPTCHA form detected';
      }

      const bodyText = normalizeText((document.body && document.body.textContent) || '').toLowerCase();
      for (const pattern of BLOCK_TEXT_PATTERNS) {
        if (bodyText.includes(pattern)) {
          return 'Google block/rate-limit signal detected: ' + pattern;
        }
      }

      return null;
    };

    const parseGoogleSerp = () => {
      const output = [];
      let position = 0;
      const anchors = document.querySelectorAll('a');

      for (const anchor of anchors) {
        const titleNode = anchor.querySelector('h3');
        if (!titleNode) {
          continue;
        }

        const title = normalizeText(titleNode.textContent || '');
        if (!title) {
          continue;
        }

        const href = anchor.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
          continue;
        }

        const absoluteHref = new URL(href, 'https://www.google.com').toString();
        const unwrapped = unwrapGoogleRedirect(absoluteHref);
        if (!isHttpUrl(unwrapped) || isGoogleChromeUrl(unwrapped)) {
          continue;
        }

        const isAd = isAdResult(anchor);
        if (isAd) {
          continue;
        }

        position += 1;
        output.push({
          title,
          url: unwrapped,
          displayUrl: extractDisplayUrl(anchor),
          snippet: extractSnippet(anchor),
          isAd,
          position
        });
      }

      return output;
    };

    return {
      blockedReason: detectSerpBlock(),
      results: parseGoogleSerp()
    };
  })();`;
}

export class GoogleScrapingProvider implements SearchProvider {
  readonly name = 'google-scraping';

  constructor(private readonly config: AppConfig) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    const numResults = Math.min(
      this.config.maxNumResults,
      Math.max(1, Math.floor(input.numResults)),
    );
    const locale = input.locale ?? this.config.searchLocale;
    const region = input.region ?? this.config.searchRegion;

    const searchUrl = new URL('https://www.google.com/search');
    searchUrl.searchParams.set('q', input.query);
    searchUrl.searchParams.set('num', String(numResults));
    searchUrl.searchParams.set('hl', locale);
    searchUrl.searchParams.set('gl', region);

    const firstAttempt = await this.fetchRawResults(searchUrl.toString(), locale);
    const withRetry = firstAttempt.length > 0
      ? firstAttempt
      : await this.fetchRawResults(searchUrl.toString(), locale);

    if (withRetry.length === 0) {
      throw new ExtractionError(
        'SERP_NO_RESULTS',
        `No Google results found for query: ${input.query}`,
      );
    }

    return withRetry
      .filter((result) => !result.isAd)
      .slice(0, numResults)
      .map((result, index) => ({
        rank: index + 1,
        title: result.title,
        url: result.url,
        displayUrl: result.displayUrl,
        snippet: result.snippet,
        source: 'google',
      }));
  }

  private async fetchRawResults(searchUrl: string, locale: string): Promise<RawSerpResult[]> {
    return withSerpWindow(this.config, locale, async (win) => {
      const timeoutMs = this.config.defaultTimeoutMs;
      const settleMs = clampSettleMs(this.config.defaultSettleMs);

      const didFinishLoadPromise = waitForDidFinishLoad(win);
      await withTimeout(
        win.loadURL(searchUrl),
        timeoutMs,
        `Timed out navigating to Google SERP: ${searchUrl}`,
      );
      await withTimeout(
        didFinishLoadPromise,
        timeoutMs,
        `Timed out waiting for did-finish-load on Google SERP: ${searchUrl}`,
      );

      await delay(settleMs);

      const execution = await withTimeout(
        win.webContents.executeJavaScript(createGoogleSerpScript()),
        timeoutMs,
        'Timed out while parsing Google SERP in renderer',
      );

      return this.validateExecutionResult(execution);
    });
  }

  private validateExecutionResult(execution: unknown): RawSerpResult[] {
    if (!execution || typeof execution !== 'object') {
      throw new ExtractionError('SERP_PARSE_FAILED', 'Invalid SERP parser payload');
    }

    const { blockedReason, results } = execution as SerpExecutionResult;

    if (typeof blockedReason === 'string' && blockedReason.length > 0) {
      throw new ExtractionError('SERP_BLOCKED', blockedReason);
    }

    if (!Array.isArray(results)) {
      throw new ExtractionError('SERP_PARSE_FAILED', 'Invalid SERP results payload');
    }

    return results.filter((result) => {
      return (
        typeof result.title === 'string' &&
        result.title.length > 0 &&
        typeof result.url === 'string' &&
        result.url.length > 0 &&
        typeof result.position === 'number' &&
        Number.isFinite(result.position) &&
        typeof result.isAd === 'boolean'
      );
    });
  }
}
