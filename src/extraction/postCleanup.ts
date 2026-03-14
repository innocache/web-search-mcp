import { parseHTML } from 'linkedom';
import { BOILERPLATE_PHRASES } from './selectorConfig.js';

const TRACKING_PARAM_PATTERN = /([?&])(utm_[a-z_]+|fbclid|gclid|mc_cid|mc_eid)=[^\s&#]+/gi;

interface LinkedomElement {
  tagName: string;
  textContent: string | null;
  nodeType: number;
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
  toString(): string;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function textContentLength(element: LinkedomElement): number {
  return normalizeWhitespace(element.textContent ?? '').length;
}

function linkTextLength(element: LinkedomElement): number {
  const links = Array.from(element.querySelectorAll('a'));
  return links.reduce((sum: number, link: LinkedomElement) => sum + textContentLength(link), 0);
}

function hasMeaningfulChild(node: LinkedomElement): boolean {
  if (node.querySelector('img,br,hr,video,audio,iframe,table,pre,code,blockquote')) {
    return true;
  }

  for (const child of Array.from(node.children)) {
    if (textContentLength(child) > 0) {
      return true;
    }
  }

  return false;
}

function removeEmptyNodes(document: LinkedomDocument): void {
  let removed = true;
  while (removed) {
    removed = false;
    const candidates = Array.from(document.querySelectorAll('p,div,section,article,span,li'));
    for (const candidate of candidates) {
      const text = normalizeWhitespace(candidate.textContent ?? '');
      if (text.length > 0) continue;
      if (hasMeaningfulChild(candidate)) continue;
      candidate.remove();
      removed = true;
    }
  }
}

function countBoilerplateMatches(text: string): number {
  let matches = 0;
  for (const pattern of BOILERPLATE_PHRASES) {
    if (pattern.test(text)) {
      matches++;
    }
  }
  return matches;
}

function removeBoilerplateBlocks(document: LinkedomDocument, warnings: string[]): void {
  const blocks = Array.from(document.querySelectorAll('p,li,small,div,section'));
  let removedAny = false;

  for (const block of blocks) {
    const text = normalizeWhitespace(block.textContent ?? '');
    if (text.length === 0) continue;
    const matches = countBoilerplateMatches(text);
    const isBoilerplate = matches >= 2 || (matches >= 1 && text.length < 100);
    if (!isBoilerplate) continue;

    block.remove();
    removedAny = true;
  }

  if (removedAny) {
    warnings.push('BOILERPLATE_REMOVED');
  }
}

function removeLinkDenseBlocks(document: LinkedomDocument, warnings: string[]): void {
  const blocks = Array.from(document.querySelectorAll('p,div,section,article,li,nav'));
  let removedAny = false;

  for (const block of blocks) {
    const totalText = textContentLength(block);
    if (totalText === 0 || totalText >= 200) continue;
    const linkedText = linkTextLength(block);
    const ratio = linkedText / totalText;

    if (ratio > 0.6) {
      block.remove();
      removedAny = true;
    }
  }

  if (removedAny) {
    warnings.push('LINK_DENSE_BLOCKS_REMOVED');
  }
}

function stripTrackingText(document: LinkedomDocument): void {
  const candidates = Array.from(document.querySelectorAll('*'));
  for (const element of candidates) {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== 3) continue;
      const source = node.textContent ?? '';
      TRACKING_PARAM_PATTERN.lastIndex = 0;
      if (!TRACKING_PARAM_PATTERN.test(source)) continue;

      TRACKING_PARAM_PATTERN.lastIndex = 0;
      const stripped = source.replace(TRACKING_PARAM_PATTERN, '$1').replace(/[?&]$/, '');
      (node as LinkedomElement & { textContent: string }).textContent = normalizeWhitespace(stripped);
    }
  }
}

function removeInlineForms(document: LinkedomDocument): void {
  // Remove forms containing email inputs or subscribe-like buttons,
  // which are inline newsletter/signup prompts that survive Readability.
  const forms = Array.from(document.querySelectorAll('form'));
  for (const form of forms) {
    const hasEmailInput = form.querySelector('input[type="email"]');
    const buttonText = normalizeWhitespace(
      Array.from(form.querySelectorAll('button,input[type="submit"]'))
        .map((el: LinkedomElement) => el.textContent ?? el.getAttribute('value') ?? '')
        .join(' ')
    );
    const isSubscribeForm = hasEmailInput || /\b(subscribe|sign\s*up|join)\b/i.test(buttonText);
    if (isSubscribeForm) {
      form.remove();
    }
  }
}

export function runPostCleanup(html: string): { cleanedHtml: string; warnings: string[] } {
  if (!html || html.trim().length === 0) {
    return { cleanedHtml: '', warnings: [] };
  }

  const wrapped = /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped);
  const doc = document as unknown as LinkedomDocument;
  const warnings: string[] = [];

  removeEmptyNodes(doc);
  removeBoilerplateBlocks(doc, warnings);
  removeLinkDenseBlocks(doc, warnings);
  stripTrackingText(doc);
  removeInlineForms(doc);

  const rawHtml = doc.body ? doc.body.innerHTML : doc.toString();
  const cleanedHtml = normalizeWhitespace(rawHtml);

  return {
    cleanedHtml,
    warnings,
  };
}
