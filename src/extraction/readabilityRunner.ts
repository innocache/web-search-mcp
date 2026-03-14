export interface ReadabilityArticle {
  title: string;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  content: string;
  textContent: string;
  length: number;
  lang: string | null;
}

interface ReadableDocument {
  cloneNode(deep?: boolean): ReadableDocument;
}

type ReaderableFn = (document: ReadableDocument) => boolean;
type ReadabilityCtor = new (document: ReadableDocument) => {
  parse(): unknown;
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLength(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function parseArticle(raw: unknown): ReadabilityArticle | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const title = readString(record.title) ?? '';
  const content = readString(record.content) ?? '';
  const textContent = readString(record.textContent) ?? '';

  if (content.length === 0 && textContent.length === 0) {
    return null;
  }

  return {
    title,
    byline: readString(record.byline),
    excerpt: readString(record.excerpt),
    siteName: readString(record.siteName),
    content,
    textContent,
    length: readLength(record.length, textContent.length),
    lang: readString(record.lang),
  };
}

function loadReadabilityGlobals(readabilitySource: string): {
  Readability: ReadabilityCtor;
  isProbablyReaderable: ReaderableFn;
} {
  const globals = globalThis as unknown as Record<string, unknown>;

  if (typeof globals.__Readability !== 'function' || typeof globals.__isProbablyReaderable !== 'function') {
    (0, eval)(readabilitySource);
  }

  const Readability = globals.__Readability;
  const isProbablyReaderable = globals.__isProbablyReaderable;

  if (typeof Readability !== 'function' || typeof isProbablyReaderable !== 'function') {
    throw new Error('Readability globals not initialized');
  }

  return {
    Readability: Readability as ReadabilityCtor,
    isProbablyReaderable: isProbablyReaderable as ReaderableFn,
  };
}

export function runReadability(
  document: Document,
  readabilitySource: string,
): { article: ReadabilityArticle | null; warnings: string[] } {
  const warnings: string[] = [];

  try {
    const { Readability, isProbablyReaderable } = loadReadabilityGlobals(readabilitySource);

    const readableDocument = document as unknown as ReadableDocument;

    if (!isProbablyReaderable(readableDocument)) {
      warnings.push('READABILITY_UNCERTAIN');
    }

    const cloned = readableDocument.cloneNode(true);
    const parsed = new Readability(cloned).parse();
    const article = parseArticle(parsed);
    if (!article) {
      warnings.push('READABILITY_FAILED');
      return { article: null, warnings };
    }

    return { article, warnings };
  } catch {
    warnings.push('READABILITY_FAILED');
    return { article: null, warnings };
  }
}
