import { parseHTML } from 'linkedom';

import { normalizeText } from './text.js';

interface DomNodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes?: ArrayLike<DomNodeLike>;
}

interface DomElementLike extends DomNodeLike {
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  children?: ArrayLike<DomElementLike>;
}

interface ParsedDocumentLike {
  body: DomElementLike;
}

interface RenderContext {
  listDepth: number;
  blockDepth: number;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function toNodes(node: DomNodeLike): DomNodeLike[] {
  return Array.from(node.childNodes ?? []);
}

function toElements(node: DomElementLike): DomElementLike[] {
  return Array.from(node.children ?? []);
}

function escapeLiteralText(text: string): string {
  return text
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .replace(/(^|\n)#/g, '$1\\#');
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }

  const chunk = value.slice(0, maxChars);
  const nextChar = value.charAt(maxChars);
  if (nextChar === '' || /\s/.test(nextChar)) {
    return chunk.trimEnd();
  }

  const lastWhitespace = Math.max(
    chunk.lastIndexOf(' '),
    chunk.lastIndexOf('\n'),
    chunk.lastIndexOf('\r'),
    chunk.lastIndexOf('\t'),
  );

  if (lastWhitespace <= 0) {
    return '';
  }

  return chunk.slice(0, lastWhitespace).trimEnd();
}

function flattenToText(node: DomNodeLike): string {
  return escapeLiteralText(node.textContent ?? '');
}

function renderInline(node: DomNodeLike, context: RenderContext): string {
  if (node.nodeType === TEXT_NODE) {
    return escapeLiteralText(node.textContent ?? '');
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return '';
  }

  const element = node as DomElementLike;
  const tag = element.tagName.toLowerCase();

  if (tag === 'a' && element.hasAttribute('href')) {
    const href = element.getAttribute('href') ?? '';
    const label = toNodes(element).map((child) => renderInline(child, context)).join('').trim() || escapeLiteralText(element.textContent ?? '');
    return `[${label}](${href})`;
  }

  if (tag === 'strong' || tag === 'b') {
    return `**${toNodes(element).map((child) => renderInline(child, context)).join('')}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${toNodes(element).map((child) => renderInline(child, context)).join('')}*`;
  }

  if (tag === 'code') {
    return `\`${escapeLiteralText(element.textContent ?? '')}\``;
  }

  if (tag === 'img' && element.hasAttribute('src')) {
    const alt = element.getAttribute('alt') ?? '';
    const src = element.getAttribute('src') ?? '';
    return `![${escapeLiteralText(alt)}](${src})`;
  }

  if (tag === 'br') {
    return '\n';
  }

  return flattenToText(element);
}

function renderInlineChildren(node: DomNodeLike, context: RenderContext): string {
  return toNodes(node).map((child) => renderInline(child, context)).join('');
}

function formatCodeFence(codeElement: DomElementLike): string {
  const classAttr = codeElement.getAttribute('class') ?? '';
  const langMatch = classAttr.match(/(?:language|lang)-([A-Za-z0-9_-]+)/);
  const lang = langMatch?.[1] ?? '';
  const codeText = (codeElement.textContent ?? '').replace(/^\n+|\n+$/g, '');
  return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
}

function renderListItemContent(item: DomElementLike, context: RenderContext): string {
  const parts: string[] = [];
  for (const child of toNodes(item)) {
    if (child.nodeType === ELEMENT_NODE) {
      const element = child as DomElementLike;
      const tag = element.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        continue;
      }
    }
    parts.push(renderInline(child, context));
  }
  return parts.join('').trim();
}

function renderListNested(item: DomElementLike, context: RenderContext): string {
  const parts: string[] = [];
  for (const child of toNodes(item)) {
    if (child.nodeType !== ELEMENT_NODE) {
      continue;
    }
    const element = child as DomElementLike;
    const tag = element.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      parts.push(renderBlock(element, { listDepth: context.listDepth + 1, blockDepth: context.blockDepth + 1 }));
    }
  }
  return parts.join('');
}

function renderList(element: DomElementLike, ordered: boolean, context: RenderContext): string {
  if (context.listDepth >= 2) {
    return `${flattenToText(element)}\n\n`;
  }

  const liChildren = toElements(element).filter((child) => child.tagName.toLowerCase() === 'li');
  const indent = ordered ? '   '.repeat(context.listDepth) : '  '.repeat(context.listDepth);

  const lines: string[] = [];
  liChildren.forEach((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- ';
    const content = renderListItemContent(item, context);
    lines.push(`${indent}${marker}${content}`.trimEnd());

    const nested = renderListNested(item, context).trim();
    if (nested.length > 0) {
      lines.push(nested);
    }
  });

  return `${lines.join('\n')}\n\n`;
}

function collectRows(node: DomElementLike): DomElementLike[] {
  const rows: DomElementLike[] = [];
  const tag = node.tagName.toLowerCase();
  if (tag === 'tr') {
    rows.push(node);
  }
  for (const child of toElements(node)) {
    rows.push(...collectRows(child));
  }
  return rows;
}

function renderTable(table: DomElementLike): string {
  const rows = collectRows(table);
  if (rows.length === 0) {
    return '';
  }

  const matrix = rows.map((row) => {
    const cells = toElements(row).filter((cell) => {
      const tag = cell.tagName.toLowerCase();
      return tag === 'th' || tag === 'td';
    });
    return cells.map((cell) => {
      const content = renderInlineChildren(cell, { listDepth: 0, blockDepth: 0 }).replace(/\|/g, '\\|').trim();
      return content.length > 0 ? content : ' ';
    });
  }).filter((row) => row.length > 0);

  if (matrix.length === 0) {
    return '';
  }

  const columnCount = Math.max(...matrix.map((row) => row.length));
  const padded = matrix.map((row) => {
    const cloned = [...row];
    while (cloned.length < columnCount) {
      cloned.push(' ');
    }
    return cloned;
  });

  const header = `| ${padded[0].join(' | ')} |`;
  const separator = `| ${new Array(columnCount).fill('---').join(' | ')} |`;
  const body = padded.slice(1).map((row) => `| ${row.join(' | ')} |`);

  return `\n\n${[header, separator, ...body].join('\n')}\n\n`;
}


const CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'main', 'aside', 'header', 'footer',
  'figure', 'figcaption', 'details', 'summary', 'nav', 'span', 'mark',
  'time', 'address', 'hgroup', 'search', 'dialog',
]);

function renderBlock(node: DomNodeLike, context: RenderContext): string {
  if (node.nodeType === TEXT_NODE) {
    return escapeLiteralText(node.textContent ?? '');
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return '';
  }

  const element = node as DomElementLike;
  const tag = element.tagName.toLowerCase();

  if (context.blockDepth >= 2 && (tag === 'table' || tag === 'blockquote' || tag === 'ul' || tag === 'ol' || tag === 'pre')) {
    return `${flattenToText(element)}\n\n`;
  }

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = Number.parseInt(tag.slice(1), 10);
    const content = renderInlineChildren(element, context).trim();
    return `\n\n${'#'.repeat(level)} ${content}\n\n`;
  }

  if (tag === 'p') {
    return `\n\n${renderInlineChildren(element, context).trim()}\n\n`;
  }

  if (tag === 'pre') {
    const firstChild = toElements(element)[0];
    if (firstChild && firstChild.tagName.toLowerCase() === 'code') {
      return formatCodeFence(firstChild);
    }
    const raw = (element.textContent ?? '').replace(/^\n+|\n+$/g, '');
    return `\n\n\`\`\`\n${raw}\n\`\`\`\n\n`;
  }

  if (tag === 'ul') {
    return renderList(element, false, context);
  }

  if (tag === 'ol') {
    return renderList(element, true, context);
  }

  if (tag === 'blockquote') {
    const inner = toNodes(element)
      .map((child) => renderBlock(child, { listDepth: context.listDepth, blockDepth: context.blockDepth + 1 }))
      .join('')
      .trim();

    if (!inner) {
      return '';
    }

    const quoted = inner.split('\n').map((line) => (line.length > 0 ? `> ${line}` : '>')).join('\n');
    return `\n\n${quoted}\n\n`;
  }

  if (tag === 'table') {
    return renderTable(element);
  }

  if (tag === 'hr') {
    return '\n\n---\n\n';
  }

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'img') {
    return `${renderInline(element, context)}\n\n`;
  }

  if (tag === 'a' || tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'code') {
    return renderInline(element, context);
  }
  if (CONTAINER_TAGS.has(tag)) {
    return toNodes(element)
      .map((child) => renderBlock(child, { listDepth: context.listDepth, blockDepth: context.blockDepth }))
      .join('');
  }
  return flattenToText(element);
}

export function htmlToMarkdownLite(html: string, maxChars: number): string {
  if (!html || html.trim().length === 0) return '';
  const wrapped = /<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(wrapped);
  const parsed = document as ParsedDocumentLike;
  const source = parsed.body ?? (document as unknown as DomElementLike);

  const markdown = toNodes(source)
    .map((node) => renderBlock(node, { listDepth: 0, blockDepth: 0 }))
    .join('')
    .replace(/<[^>]+>/g, '');

  const normalized = normalizeText(markdown, Number.MAX_SAFE_INTEGER);
  return truncateAtWordBoundary(normalized, maxChars);
}
