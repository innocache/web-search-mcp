/// <reference types="vitest/globals" />

import {
  asRecord,
  buildRendererScript,
  computeLinkDensity,
  countBoilerplateHits,
  countSentences,
  normalizeWhitespace,
  parseArticle,
  parseMetadata,
  parseRendererResult,
  parseWarnings,
  plainTextFromHtml,
  runNormalizeStage,
  toStringOrNull,
} from '../../../src/extraction/pipeline.js';
import type { PreExtractionMetadata } from '../../../src/extraction/metadataExtractor.js';
import type { ReadabilityArticle } from '../../../src/extraction/readabilityRunner.js';
import type { RendererExtractionResult, StageFiveOutput } from '../../../src/extraction/pipeline.js';

const EMPTY_METADATA: PreExtractionMetadata = {
  title: null,
  description: null,
  author: null,
  siteName: null,
  publishedDate: null,
  imageUrl: null,
  canonicalUrl: null,
  language: null,
};

describe('pipeline helper functions', () => {
  const asDocument = (body: string): string => `<html><body>${body}</body></html>`;

  describe('normalizeWhitespace', () => {
    it('returns empty string when input is empty', () => {
      expect(normalizeWhitespace('')).toBe('');
    });

    it('returns empty string when input is only one space', () => {
      expect(normalizeWhitespace(' ')).toBe('');
    });

    it('collapses repeated spaces to single spaces', () => {
      expect(normalizeWhitespace('alpha   beta    gamma')).toBe('alpha beta gamma');
    });

    it('collapses tabs and newlines to single spaces', () => {
      expect(normalizeWhitespace('\talpha\n\n beta\r\n gamma\t')).toBe('alpha beta gamma');
    });

    it('keeps already normalized text unchanged', () => {
      expect(normalizeWhitespace('already clean text')).toBe('already clean text');
    });
  });

  describe('plainTextFromHtml', () => {
    it('extracts paragraph text', () => {
      expect(plainTextFromHtml(asDocument('<p>Hello world.</p>'))).toBe('Hello world.');
    });

    it('extracts nested text in source order', () => {
      const html = asDocument('<article><h1>Title</h1><p>Body <strong>content</strong>.</p></article>');
      expect(plainTextFromHtml(html)).toBe('Title\n\nBody content.');
    });

    it('returns empty string for empty body', () => {
      expect(plainTextFromHtml('<html><body></body></html>')).toBe('');
    });

    it('decodes HTML entities', () => {
      expect(plainTextFromHtml(asDocument('<p>Tom &amp; Jerry</p>'))).toBe('Tom & Jerry');
    });
  });

  describe('runNormalizeStage', () => {
    it('returns normalizedText as normalizedContent for text format', () => {
      const result: StageFiveOutput = runNormalizeStage(asDocument('<p>alpha beta gamma</p>'), 'text', 100);
      expect(result.normalizedContent).toBe(result.normalizedText);
      expect(result.normalizedText).toBe('alpha beta gamma');
    });

    it('returns markdown content for markdown format', () => {
      const result = runNormalizeStage(asDocument('<p>Hello <strong>world</strong>.</p>'), 'markdown', 200);
      expect(result.normalizedContent).toBe('Hello **world**.');
      expect(result.normalizedText).toBe('Hello world.');
    });

    it('returns cleaned html content for html format', () => {
      const result = runNormalizeStage(asDocument('<p class="x" data-id="1">Body <em>text</em></p>'), 'html', 200);
      expect(result.normalizedContent).toBe('<p>Body <em>text</em></p>');
      expect(result.normalizedText).toBe('Body text');
    });

    it('applies maxChars truncation to normalizedText in text mode', () => {
      const result = runNormalizeStage(asDocument('<p>one two three four</p>'), 'text', 8);
      expect(result.normalizedText).toBe('one two');
      expect(result.normalizedContent).toBe('one two');
    });

    it('applies maxChars truncation to markdown content', () => {
      const result = runNormalizeStage(asDocument('<p>one two three four</p>'), 'markdown', 8);
      expect(result.normalizedContent).toBe('one two');
      expect(result.normalizedText).toBe('one two');
    });

    it('always includes normalizedText for markdown output', () => {
      const result = runNormalizeStage(asDocument('<h1>Title</h1><p>Body</p>'), 'markdown', 200);
      expect(result.normalizedText).toBe('Title\n\nBody');
      expect(result.normalizedText.length).toBeGreaterThan(0);
    });

    it('always includes normalizedText for html output', () => {
      const result = runNormalizeStage(asDocument('<h1>Title</h1><p>Body</p>'), 'html', 200);
      expect(result.normalizedText).toBe('Title\n\nBody');
      expect(result.normalizedText.length).toBeGreaterThan(0);
    });
  });

  describe('countSentences', () => {
    it('returns 0 for empty string', () => {
      expect(countSentences('')).toBe(0);
    });

    it('counts a single sentence ending with a period', () => {
      expect(countSentences('One sentence.')).toBe(1);
    });

    it('counts multiple sentences', () => {
      expect(countSentences('First. Second. Third.')).toBe(3);
    });

    it('counts exclamation and question punctuation', () => {
      expect(countSentences('Wow! Really? Yes!')).toBe(3);
    });

    it('returns 0 when there is no terminating punctuation', () => {
      expect(countSentences('This has no sentence ending')).toBe(0);
    });

    it('counts sentence punctuation at end of input', () => {
      expect(countSentences('Ends right here!')).toBe(1);
    });
  });

  describe('computeLinkDensity', () => {
    it('returns 0 when there are no links', () => {
      expect(computeLinkDensity(asDocument('<p>Just article text.</p>'))).toBe(0);
    });

    it('returns 1 when all visible text is link text', () => {
      expect(computeLinkDensity(asDocument('<a href="/x">All linked text</a>'))).toBe(1);
    });

    it('returns expected ratio for mixed linked and non-linked text', () => {
      const density = computeLinkDensity(asDocument('<p><a href="/x">abc</a>def</p>'));
      expect(density).toBeCloseTo(3 / 6, 8);
    });

    it('returns 0 for empty body text', () => {
      expect(computeLinkDensity('<html><body></body></html>')).toBe(0);
    });

    it('clamps ratio to 1 when nested anchors double-count linked text', () => {
      const html = asDocument('<p><a href="/x">word <a href="/y">word</a></a></p>');
      expect(computeLinkDensity(html)).toBe(1);
    });
  });

  describe('countBoilerplateHits', () => {
    it('returns 0 for clean article text', () => {
      expect(countBoilerplateHits('This is an original article body with no boilerplate.')).toBe(0);
    });

    it('counts all rights reserved and privacy policy', () => {
      expect(countBoilerplateHits('All rights reserved. Read our Privacy Policy.')).toBe(2);
    });

    it('counts subscribe now phrase', () => {
      expect(countBoilerplateHits('Please subscribe now for updates.')).toBe(1);
    });

    it('returns 0 for empty input', () => {
      expect(countBoilerplateHits('')).toBe(0);
    });

    it('counts distinct matching patterns once each', () => {
      const text = 'Copyright notice. Privacy policy. Contact us any time.';
      expect(countBoilerplateHits(text)).toBe(3);
    });
  });

  describe('buildRendererScript', () => {
    it('starts with iife prefix', () => {
      const script = buildRendererScript('/* readability source */');
      expect(script.startsWith('(() => {')).toBe(true);
    });

    it('ends with iife suffix', () => {
      const script = buildRendererScript('/* readability source */');
      expect(script.endsWith('})();')).toBe(true);
    });

    it('embeds readability source text', () => {
      const source = 'window.__Readability = function() {};';
      const script = buildRendererScript(source);
      expect(script).toContain(source);
    });

    it('includes extraction helper declarations', () => {
      const script = buildRendererScript('/* src */');
      expect(script).toContain('function extractMetadata()');
      expect(script).toContain('function runReadability()');
    });
  });

  describe('asRecord', () => {
    it('returns object input as record', () => {
      const value = { key: 'value' };
      expect(asRecord(value)).toEqual({ key: 'value' });
    });

    it('returns null for null', () => {
      expect(asRecord(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(asRecord(undefined)).toBeNull();
    });

    it('returns null for strings', () => {
      expect(asRecord('nope')).toBeNull();
    });

    it('returns arrays as records because arrays are objects', () => {
      const record = asRecord([1, 2, 3]);
      expect(record).not.toBeNull();
      expect(Array.isArray(record)).toBe(true);
    });
  });

  describe('toStringOrNull', () => {
    it('returns normalized non-empty string', () => {
      expect(toStringOrNull('hello world')).toBe('hello world');
    });

    it('returns null for empty string', () => {
      expect(toStringOrNull('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(toStringOrNull('   \n\t  ')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(toStringOrNull(42)).toBeNull();
    });

    it('trims and collapses whitespace', () => {
      expect(toStringOrNull('  alpha   beta  ')).toBe('alpha beta');
    });
  });

  describe('parseMetadata', () => {
    it('parses a complete metadata object', () => {
      const value = {
        title: ' Title ',
        description: ' Description ',
        author: ' Author ',
        siteName: ' Site ',
        publishedDate: ' 2024-01-01 ',
        imageUrl: ' https://example.com/img.png ',
        canonicalUrl: ' https://example.com/article ',
        language: ' en ',
      };

      const parsed: PreExtractionMetadata = parseMetadata(value);
      expect(parsed).toEqual({
        title: 'Title',
        description: 'Description',
        author: 'Author',
        siteName: 'Site',
        publishedDate: '2024-01-01',
        imageUrl: 'https://example.com/img.png',
        canonicalUrl: 'https://example.com/article',
        language: 'en',
      });
    });

    it('returns all null fields for null input', () => {
      expect(parseMetadata(null)).toEqual(EMPTY_METADATA);
    });

    it('returns null for missing fields in partial object', () => {
      const parsed = parseMetadata({ title: 'Only title', language: 'en' });
      expect(parsed).toEqual({
        ...EMPTY_METADATA,
        title: 'Only title',
        language: 'en',
      });
    });

    it('returns all null fields for non-object input', () => {
      expect(parseMetadata('metadata')).toEqual(EMPTY_METADATA);
    });
  });

  describe('parseArticle', () => {
    it('parses a complete article object', () => {
      const raw = {
        title: ' Title ',
        byline: ' Byline ',
        excerpt: ' Excerpt ',
        siteName: ' Site ',
        content: ' <p>content</p> ',
        textContent: ' body text ',
        length: 123,
        lang: ' en ',
      };

      const parsed: ReadabilityArticle | null = parseArticle(raw);
      expect(parsed).toEqual({
        title: 'Title',
        byline: 'Byline',
        excerpt: 'Excerpt',
        siteName: 'Site',
        content: '<p>content</p>',
        textContent: 'body text',
        length: 123,
        lang: 'en',
      });
    });

    it('returns null for null input', () => {
      expect(parseArticle(null)).toBeNull();
    });

    it('returns null when both content and textContent are empty', () => {
      const parsed = parseArticle({ content: '   ', textContent: '   ' });
      expect(parsed).toBeNull();
    });

    it('uses defaults for missing optional fields', () => {
      const parsed = parseArticle({ textContent: 'Body only' });
      expect(parsed).toEqual({
        title: '',
        byline: null,
        excerpt: null,
        siteName: null,
        content: '',
        textContent: 'Body only',
        length: 'Body only'.length,
        lang: null,
      });
    });

    it('falls back length to textContent length when length is invalid', () => {
      const parsed = parseArticle({ textContent: 'abcdef', length: Number.NaN });
      expect(parsed?.length).toBe(6);
    });

    it('clamps negative length to zero', () => {
      const parsed = parseArticle({ content: '<p>x</p>', textContent: 'x', length: -50 });
      expect(parsed?.length).toBe(0);
    });

    it('accepts empty content when textContent is present', () => {
      const parsed = parseArticle({ content: '', textContent: 'visible text' });
      expect(parsed).not.toBeNull();
      expect(parsed?.textContent).toBe('visible text');
    });
  });

  describe('parseWarnings', () => {
    it('returns the same array for string-only warnings', () => {
      expect(parseWarnings(['A', 'B'])).toEqual(['A', 'B']);
    });

    it('filters non-string values from mixed arrays', () => {
      expect(parseWarnings(['A', 1, 'B', null, false])).toEqual(['A', 'B']);
    });

    it('returns empty array for non-array input', () => {
      expect(parseWarnings('not array')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(parseWarnings(undefined)).toEqual([]);
    });
  });

  describe('parseRendererResult', () => {
    it('parses valid metadata, article, and warnings', () => {
      const value = {
        metadata: {
          title: 'Title',
          language: 'en',
        },
        article: {
          title: 'Article title',
          content: '<p>Body</p>',
          textContent: 'Body',
          length: 4,
        },
        warnings: ['READABILITY_UNCERTAIN', 1],
      };

      const result: RendererExtractionResult = parseRendererResult(value);
      expect(result.metadata.title).toBe('Title');
      expect(result.metadata.language).toBe('en');
      expect(result.article?.title).toBe('Article title');
      expect(result.warnings).toEqual(['READABILITY_UNCERTAIN']);
    });

    it('returns defaults and READABILITY_FAILED warning for null input', () => {
      expect(parseRendererResult(null)).toEqual({
        metadata: EMPTY_METADATA,
        article: null,
        warnings: ['READABILITY_FAILED'],
      });
    });

    it('handles missing fields gracefully', () => {
      const result = parseRendererResult({});
      expect(result).toEqual({
        metadata: EMPTY_METADATA,
        article: null,
        warnings: [],
      });
    });

    it('returns null article when article has no usable content', () => {
      const result = parseRendererResult({
        article: { content: '   ', textContent: '   ' },
        warnings: ['READABILITY_UNCERTAIN'],
      });

      expect(result.article).toBeNull();
      expect(result.warnings).toEqual(['READABILITY_UNCERTAIN']);
    });

    it('parses full object with all metadata fields', () => {
      const value = {
        metadata: {
          title: 'Title',
          description: 'Description',
          author: 'Author',
          siteName: 'Site',
          publishedDate: '2024-01-01',
          imageUrl: 'https://example.com/image.png',
          canonicalUrl: 'https://example.com/article',
          language: 'en',
        },
        article: {
          title: 'A',
          byline: 'B',
          excerpt: 'C',
          siteName: 'D',
          content: '<p>Body</p>',
          textContent: 'Body',
          length: 4,
          lang: 'en',
        },
        warnings: ['READABILITY_UNCERTAIN', 'READABILITY_FAILED'],
      };

      const result = parseRendererResult(value);
      expect(result).toEqual({
        metadata: {
          title: 'Title',
          description: 'Description',
          author: 'Author',
          siteName: 'Site',
          publishedDate: '2024-01-01',
          imageUrl: 'https://example.com/image.png',
          canonicalUrl: 'https://example.com/article',
          language: 'en',
        },
        article: {
          title: 'A',
          byline: 'B',
          excerpt: 'C',
          siteName: 'D',
          content: '<p>Body</p>',
          textContent: 'Body',
          length: 4,
          lang: 'en',
        },
        warnings: ['READABILITY_UNCERTAIN', 'READABILITY_FAILED'],
      });
    });
  });
});
