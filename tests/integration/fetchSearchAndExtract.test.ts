/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import type { ExtractionResult } from '../../src/extraction/pipeline.js';
const { mockExtractUrl } = vi.hoisted(() => ({
  mockExtractUrl: vi.fn<() => Promise<ExtractionResult>>(),
}));
vi.mock('../../src/extraction/pipeline.js', () => ({
  extractUrl: mockExtractUrl,
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerFetchSearchAndExtractTool } from '../../src/server/tools/fetchSearchAndExtract.js';
import type { AppConfig } from '../../src/util/config.js';
import type { SearchProvider } from '../../src/search/SearchProvider.js';
import type { SearchResult } from '../../src/search/models.js';

function createMockConfig(): AppConfig {
  return {
    searchProvider: 'mock',
    searchLocale: 'en-US',
    searchRegion: 'us',
    defaultNumResults: 5,
    maxNumResults: 10,
    defaultTimeoutMs: 15000,
    defaultSettleMs: 1200,
    maxCharsDefault: 12000,
    browserConcurrency: 2,
    logLevel: 'error',
    resourceBlockImages: true,
    resourceBlockMedia: true,
    resourceBlockFonts: true,
    headlessMode: true,
    searchMinDelayMs: 0,
    searchMaxDelayMs: 0,
  };
}

function createMockExtractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    url: 'https://example.com/article',
    finalUrl: 'https://example.com/article',
    outputFormat: 'text',
    content: 'Extracted article content that is meaningful and useful.',
    cleanedHtml: '<p>Extracted article content that is meaningful and useful.</p>',
    textContent: 'Extracted article content that is meaningful and useful.',
    title: 'Test Article',
    byline: 'Test Author',
    excerpt: 'A test article excerpt.',
    siteName: 'Example',
    language: 'en',
    author: 'Test Author',
    description: 'A test article description.',
    publishedDate: '2025-01-01',
    imageUrl: null,
    canonicalUrl: null,
    score: 80,
    scoreLabel: 'good',
    weakExtraction: false,
    warnings: [],
    ...overrides,
  };
}

function createMockSearchProvider(results: SearchResult[] = []): SearchProvider {
  return {
    name: 'mock-provider',
    async search() {
      return results;
    },
    async isAvailable() {
      return true;
    },
  };
}

const THREE_SEARCH_RESULTS: SearchResult[] = [
  { rank: 1, title: 'First Result', url: 'https://example.com/first', snippet: 'First snippet.' },
  { rank: 2, title: 'Second Result', url: 'https://example.com/second', snippet: 'Second snippet.' },
  { rank: 3, title: 'Third Result', url: 'https://example.com/third', snippet: 'Third snippet.' },
];

async function setup(
  config: AppConfig,
  provider: SearchProvider,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerFetchSearchAndExtractTool(server, config, provider);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('fetch_search_and_extract tool', () => {
  beforeEach(() => {
    mockExtractUrl.mockReset();
  });

  it('lists fetch_search_and_extract in available tools', async () => {
    const config = createMockConfig();
    const provider = createMockSearchProvider();
    const { client, cleanup } = await setup(config, provider);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('fetch_search_and_extract');
    } finally {
      await cleanup();
    }
  });

  it('searches and extracts content from multiple results', async () => {
    mockExtractUrl.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/first') {
        return createMockExtractionResult({
          url: 'https://example.com/first',
          title: 'First Article',
          content: 'First article content.',
          textContent: 'First article content.',
          score: 90,
        });
      }
      if (url === 'https://example.com/second') {
        return createMockExtractionResult({
          url: 'https://example.com/second',
          title: 'Second Article',
          content: 'Second article content.',
          textContent: 'Second article content.',
          score: 75,
        });
      }
      return createMockExtractionResult({
        url: 'https://example.com/third',
        title: 'Third Article',
        content: 'Third article content.',
        textContent: 'Third article content.',
        score: 60,
      });
    });

    const config = createMockConfig();
    const provider = createMockSearchProvider(THREE_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'test query', num_results: 3 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

      expect(parsed.query).toBe('test query');
      expect(parsed.search_results).toHaveLength(3);
      expect(parsed.extracted_results).toHaveLength(3);

      expect(parsed.search_results[0].rank).toBe(1);
      expect(parsed.search_results[0].title).toBe('First Result');
      expect(parsed.search_results[1].rank).toBe(2);
      expect(parsed.search_results[2].rank).toBe(3);

      expect(parsed.extracted_results[0].rank).toBe(1);
      expect(parsed.extracted_results[0].title).toBe('First Article');
      expect(parsed.extracted_results[0].extraction_score).toBe(90);
      expect(parsed.extracted_results[1].rank).toBe(2);
      expect(parsed.extracted_results[2].rank).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it('handles partial extraction failures gracefully', async () => {
    mockExtractUrl.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/first') {
        return createMockExtractionResult({
          url: 'https://example.com/first',
          title: 'First Article',
          textContent: 'First article content.',
          score: 85,
        });
      }
      if (url === 'https://example.com/second') {
        throw new Error('Page load timeout for second result');
      }
      return createMockExtractionResult({
        url: 'https://example.com/third',
        title: 'Third Article',
        textContent: 'Third article content.',
        score: 70,
      });
    });

    const config = createMockConfig();
    const provider = createMockSearchProvider(THREE_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'partial failure', num_results: 3 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

      expect(parsed.extracted_results).toHaveLength(3);

      const successful1 = parsed.extracted_results.find((r: { rank: number }) => r.rank === 1);
      expect(successful1.extraction_score).toBe(85);
      expect(successful1.title).toBe('First Article');

      const failed = parsed.extracted_results.find((r: { rank: number }) => r.rank === 2);
      expect(failed.content_length).toBe(0);
      expect(failed.extraction_score).toBe(0);
      expect(failed.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('EXTRACTION_FAILED')]),
      );
      expect(failed.warnings[0]).toContain('Page load timeout for second result');

      const successful3 = parsed.extracted_results.find((r: { rank: number }) => r.rank === 3);
      expect(successful3.extraction_score).toBe(70);
    } finally {
      await cleanup();
    }
  });

  it('returns isError when search provider throws', async () => {
    const config = createMockConfig();
    const provider: SearchProvider = {
      name: 'broken',
      async search() {
        throw new Error('Network error during search');
      },
      async isAvailable() {
        return false;
      },
    };
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'doomed query' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toContain('Network error during search');
    } finally {
      await cleanup();
    }
  });

  it('returns extracted results sorted by rank', async () => {
    const reverseResults: SearchResult[] = [
      { rank: 3, title: 'Third', url: 'https://example.com/third', snippet: 'Third.' },
      { rank: 1, title: 'First', url: 'https://example.com/first', snippet: 'First.' },
      { rank: 2, title: 'Second', url: 'https://example.com/second', snippet: 'Second.' },
    ];

    mockExtractUrl.mockImplementation(async (url: string) => {
      const rank = url.includes('first') ? 1 : url.includes('second') ? 2 : 3;
      return createMockExtractionResult({
        url,
        title: `Article ${rank}`,
        textContent: `Content ${rank}`,
        score: 90 - rank * 10,
      });
    });

    const config = createMockConfig();
    const provider = createMockSearchProvider(reverseResults);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'rank order test', num_results: 3 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

      const ranks = parsed.extracted_results.map((r: { rank: number }) => r.rank);
      expect(ranks).toEqual([1, 2, 3]);
    } finally {
      await cleanup();
    }
  });

  it('passes output_format and max_chars_per_result to extractUrl', async () => {
    mockExtractUrl.mockResolvedValue(createMockExtractionResult());

    const singleResult: SearchResult[] = [
      { rank: 1, title: 'Result', url: 'https://example.com/page', snippet: 'Snippet.' },
    ];

    const config = createMockConfig();
    const provider = createMockSearchProvider(singleResult);
    const { client, cleanup } = await setup(config, provider);
    try {
      await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: {
          query: 'param test',
          num_results: 1,
          output_format: 'markdown',
          max_chars_per_result: 5000,
          timeout_ms: 10000,
        },
      });

      expect(mockExtractUrl).toHaveBeenCalledOnce();
      const [url, _cfg, opts] = mockExtractUrl.mock.calls[0]!;
      expect(url).toBe('https://example.com/page');
      expect(opts).toEqual({
        outputFormat: 'markdown',
        maxChars: 5000,
        timeoutMs: 10000,
        waitUntil: 'load',
        settleMs: 1200,
      });
    } finally {
      await cleanup();
    }
  });

  it('handles empty search results without calling extractUrl', async () => {
    const config = createMockConfig();
    const provider = createMockSearchProvider([]);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'empty search' },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
      expect(parsed.search_results).toHaveLength(0);
      expect(parsed.extracted_results).toHaveLength(0);
      expect(mockExtractUrl).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('includes failed result title from search result when extraction fails', async () => {
    mockExtractUrl.mockRejectedValue(new Error('Connection refused'));

    const singleResult: SearchResult[] = [
      { rank: 1, title: 'Original Title', url: 'https://example.com/broken', snippet: 'Snippet.' },
    ];

    const config = createMockConfig();
    const provider = createMockSearchProvider(singleResult);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'fail test' },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
      const failedResult = parsed.extracted_results[0];
      expect(failedResult.title).toBe('Original Title');
      expect(failedResult.url).toBe('https://example.com/broken');
      expect(failedResult.content_length).toBe(0);
      expect(failedResult.extraction_score).toBe(0);
      expect(failedResult.warnings[0]).toContain('EXTRACTION_FAILED');
      expect(failedResult.warnings[0]).toContain('Connection refused');
    } finally {
      await cleanup();
    }
  });

  it('all extractions fail but search succeeds — no isError, all results marked failed', async () => {
    mockExtractUrl.mockRejectedValue(new Error('All pages down'));

    const config = createMockConfig();
    const provider = createMockSearchProvider(THREE_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'fetch_search_and_extract',
        arguments: { query: 'all fail', num_results: 3 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

      expect(parsed.search_results).toHaveLength(3);
      expect(parsed.extracted_results).toHaveLength(3);

      for (const r of parsed.extracted_results) {
        expect(r.content_length).toBe(0);
        expect(r.extraction_score).toBe(0);
        expect(r.warnings[0]).toContain('EXTRACTION_FAILED');
      }
    } finally {
      await cleanup();
    }
  });
});
