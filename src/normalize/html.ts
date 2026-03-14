import { parseHTML } from 'linkedom';

interface DomElementLike {
  tagName: string;
  children?: ArrayLike<DomElementLike>;
  attributes?: ArrayLike<{ name: string }>;
  innerHTML: string;
  removeAttribute(name: string): void;
}

interface ParsedDocumentLike {
  body: DomElementLike;
}

const PRESERVED_ATTRIBUTES = new Set([
  'src',
  'href',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'headers',
]);

function walkElements(root: DomElementLike): DomElementLike[] {
  const elements: DomElementLike[] = [root];
  for (const child of Array.from(root.children ?? [])) {
    elements.push(...walkElements(child));
  }
  return elements;
}

function truncateHtml(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }

  const tagBoundary = value.lastIndexOf('>', maxChars - 1);
  if (tagBoundary > 0) {
    const candidate = value.slice(0, tagBoundary + 1).trimEnd();
    const wrappedCandidate = `<html><body>${candidate}</body></html>`;
    const reparsed = parseHTML(wrappedCandidate).document as ParsedDocumentLike;
    return reparsed.body.innerHTML.trimEnd();
  }

  const whitespaceBoundary = value.lastIndexOf(' ', maxChars - 1);
  if (whitespaceBoundary > 0) {
    return value.slice(0, whitespaceBoundary).trimEnd();
  }

  return value.slice(0, maxChars).trimEnd();
}

export function cleanHtml(html: string, maxChars: number): string {
  if (!html || html.trim().length === 0) return '';
  const wrapped = /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped);
  const parsed = document as ParsedDocumentLike;
  const body = parsed.body;

  for (const element of walkElements(body)) {
    const attributeNames = Array.from(element.attributes ?? []).map((attribute) => attribute.name);
    for (const attributeName of attributeNames) {
      const lower = attributeName.toLowerCase();
      const shouldKeep = PRESERVED_ATTRIBUTES.has(lower);
      if (!shouldKeep || lower === 'class' || lower === 'id' || lower === 'style' || lower.startsWith('data-')) {
        element.removeAttribute(attributeName);
      }
    }
  }

  const serialized = body.innerHTML.trim();
  return truncateHtml(serialized, maxChars);
}
