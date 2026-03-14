export interface PreExtractionMetadata {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  publishedDate: string | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
  language: string | null;
}

interface JsonLdSignal {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  publishedDate: string | null;
  imageUrl: string | null;
}

interface BrowserElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
}

interface BrowserDocument {
  title: string;
  documentElement: BrowserElement;
  querySelector(selector: string): BrowserElement | null;
  querySelectorAll(selector: string): BrowserElement[];
}

const EMPTY_SIGNAL: JsonLdSignal = {
  title: null,
  description: null,
  author: null,
  siteName: null,
  publishedDate: null,
  imageUrl: null,
};

function cleanString(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function readMetaContent(document: BrowserDocument, selector: string): string | null {
  const meta = document.querySelector(selector);
  if (!meta) return null;
  return cleanString(meta.getAttribute('content'));
}

function valueFromUnknown(input: unknown): string | null {
  if (typeof input === 'string') return cleanString(input);
  return null;
}

function imageFromUnknown(input: unknown): string | null {
  if (typeof input === 'string') return cleanString(input);
  if (Array.isArray(input)) {
    for (const item of input) {
      const extracted = imageFromUnknown(item);
      if (extracted) return extracted;
    }
    return null;
  }

  if (typeof input === 'object' && input !== null) {
    const maybeRecord = input as Record<string, unknown>;
    const candidate = valueFromUnknown(maybeRecord.url) ?? valueFromUnknown(maybeRecord.contentUrl);
    return candidate;
  }

  return null;
}

function authorFromUnknown(input: unknown): string | null {
  if (typeof input === 'string') return cleanString(input);
  if (Array.isArray(input)) {
    for (const item of input) {
      const extracted = authorFromUnknown(item);
      if (extracted) return extracted;
    }
    return null;
  }

  if (typeof input === 'object' && input !== null) {
    const maybeRecord = input as Record<string, unknown>;
    return valueFromUnknown(maybeRecord.name) ?? valueFromUnknown(maybeRecord.alternateName);
  }

  return null;
}

function extractSignalFromNode(input: unknown): JsonLdSignal {
  if (typeof input !== 'object' || input === null) {
    return EMPTY_SIGNAL;
  }

  const node = input as Record<string, unknown>;
  const publisher =
    typeof node.publisher === 'object' && node.publisher !== null
      ? (node.publisher as Record<string, unknown>)
      : null;

  return {
    title: valueFromUnknown(node.headline) ?? valueFromUnknown(node.name),
    description: valueFromUnknown(node.description),
    author: authorFromUnknown(node.author),
    siteName: valueFromUnknown(publisher?.name),
    publishedDate:
      valueFromUnknown(node.datePublished) ?? valueFromUnknown(node.dateCreated) ?? valueFromUnknown(node.uploadDate),
    imageUrl: imageFromUnknown(node.image),
  };
}

function extractFromJsonLd(document: BrowserDocument): JsonLdSignal {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const accumulator: JsonLdSignal = { ...EMPTY_SIGNAL };

  for (const script of scripts) {
    const jsonText = script.textContent;
    if (!jsonText || jsonText.trim().length === 0) continue;

    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const nodes: unknown[] = [];

      if (Array.isArray(parsed)) {
        nodes.push(...parsed);
      } else if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record['@graph'])) {
          nodes.push(...(record['@graph'] as unknown[]));
        }
        nodes.push(parsed);
      }

      for (const node of nodes) {
        const signal = extractSignalFromNode(node);
        accumulator.title ??= signal.title;
        accumulator.description ??= signal.description;
        accumulator.author ??= signal.author;
        accumulator.siteName ??= signal.siteName;
        accumulator.publishedDate ??= signal.publishedDate;
        accumulator.imageUrl ??= signal.imageUrl;
      }
    } catch {
      continue;
    }
  }

  return accumulator;
}

export function extractMetadata(document: Document): PreExtractionMetadata {
  const browserDocument = document as unknown as BrowserDocument;
  const jsonLd = extractFromJsonLd(browserDocument);

  const ogTitle = readMetaContent(browserDocument, 'meta[property="og:title"]');
  const ogDescription = readMetaContent(browserDocument, 'meta[property="og:description"]');
  const ogImage =
    readMetaContent(browserDocument, 'meta[property="og:image"]') ??
    readMetaContent(browserDocument, 'meta[name="twitter:image"]');
  const ogSiteName = readMetaContent(browserDocument, 'meta[property="og:site_name"]');
  const ogPublished =
    readMetaContent(browserDocument, 'meta[property="article:published_time"]') ??
    readMetaContent(browserDocument, 'meta[name="article:published_time"]');

  const metaAuthor =
    readMetaContent(browserDocument, 'meta[name="author"]') ??
    readMetaContent(browserDocument, 'meta[property="author"]');
  const metaDescription =
    readMetaContent(browserDocument, 'meta[name="description"]') ??
    readMetaContent(browserDocument, 'meta[property="description"]') ??
    readMetaContent(browserDocument, 'meta[name="twitter:description"]');

  const canonicalElement = browserDocument.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalElement ? cleanString(canonicalElement.getAttribute('href')) : null;

  const htmlLang = browserDocument.documentElement.getAttribute('lang');
  const titleFromTag =
    cleanString(browserDocument.querySelector('title')?.textContent ?? browserDocument.title);

  return {
    title: ogTitle ?? jsonLd.title ?? titleFromTag,
    description: ogDescription ?? metaDescription ?? jsonLd.description,
    author: metaAuthor ?? jsonLd.author,
    siteName: ogSiteName ?? jsonLd.siteName,
    publishedDate: ogPublished ?? jsonLd.publishedDate,
    imageUrl: ogImage ?? jsonLd.imageUrl,
    canonicalUrl,
    language: cleanString(htmlLang),
  };
}
