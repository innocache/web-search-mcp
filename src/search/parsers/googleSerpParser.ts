import { unwrapGoogleRedirect } from '../../util/url.js';
import type { RawSerpResult } from '../models.js';

interface SerpElement {
  textContent: string | null;
  parentElement: SerpElement | null;
  nextElementSibling: SerpElement | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): SerpElement | null;
  querySelectorAll(selector: string): SerpElement[];
  closest(selector: string): SerpElement | null;
}

interface Document {
  location: { href: string };
  body: SerpElement | null;
  querySelector(selector: string): SerpElement | null;
  querySelectorAll(selector: string): SerpElement[];
}

const BLOCK_TEXT_PATTERNS = [
  'unusual traffic',
  'not a robot',
  'automated queries',
  'our systems have detected',
  'complete the captcha',
  'verify you are human',
  'recaptcha',
];

const AD_BADGE_TEXT = new Set(['ad', 'ads', 'sponsored']);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isHttpUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isGoogleChromeUrl(href: string): boolean {
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
      '/policies',
    ].some((path) => parsed.pathname.startsWith(path));
  } catch {
    return true;
  }
}

function nearestContainer(anchor: SerpElement): SerpElement {
  return (
    anchor.closest('article, li, div, section') ??
    anchor.parentElement ??
    anchor
  );
}

function extractDisplayUrl(anchor: SerpElement): string | undefined {
  const container = nearestContainer(anchor);
  const cite = container.querySelector('cite') ?? container.parentElement?.querySelector('cite');
  const text = cite ? normalizeText(cite.textContent ?? '') : '';
  return text || undefined;
}

function collectTextCandidates(container: SerpElement): string[] {
  const results: string[] = [];
  const candidates = container.querySelectorAll('span, div');
  for (const candidate of candidates) {
    if (candidate.querySelector('h3, cite, a, script, style, noscript')) {
      continue;
    }
    const text = normalizeText(candidate.textContent ?? '');
    if (text.length >= 30) {
      results.push(text);
    }
  }
  return results;
}

function extractSnippet(anchor: SerpElement): string | undefined {
  const container = nearestContainer(anchor);
  const candidates: string[] = [];
  if (anchor.parentElement?.nextElementSibling) {
    candidates.push(...collectTextCandidates(anchor.parentElement.nextElementSibling));
  }
  if (container.nextElementSibling) {
    candidates.push(...collectTextCandidates(container.nextElementSibling));
  }
  candidates.push(...collectTextCandidates(container));

  const snippet = candidates.find((text) => text.length >= 40 && text.length <= 360);
  return snippet;
}

function isAdResult(anchor: SerpElement): boolean {
  const container = nearestContainer(anchor);
  const sponsoredAria = container.querySelector(
    '[aria-label*="sponsored" i], [aria-label="ad" i], [aria-label="ads" i]',
  );
  if (sponsoredAria) {
    return true;
  }

  const badgeElements = container.querySelectorAll('span, div, label');
  for (const badge of badgeElements) {
    const text = normalizeText(badge.textContent ?? '').toLowerCase();
    if (text.length > 0 && text.length <= 14 && AD_BADGE_TEXT.has(text)) {
      return true;
    }
  }

  return false;
}

export function parseGoogleSerp(document: Document): RawSerpResult[] {
  const output: RawSerpResult[] = [];
  let position = 0;
  const anchors = document.querySelectorAll('a');

  for (const anchorElement of anchors) {
    const anchor = anchorElement;
    const titleNode = anchor.querySelector('h3');
    if (!titleNode) {
      continue;
    }

    const title = normalizeText(titleNode.textContent ?? '');
    if (!title) {
      continue;
    }

    const href = anchor.getAttribute('href') ?? '';
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
      position,
    });
  }

  return output;
}

export function detectSerpBlock(document: Document): string | null {
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

  const bodyText = normalizeText(document.body?.textContent ?? '').toLowerCase();
  for (const pattern of BLOCK_TEXT_PATTERNS) {
    if (bodyText.includes(pattern)) {
      return `Google block/rate-limit signal detected: ${pattern}`;
    }
  }

  return null;
}
