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
import { registerOpenResultTool } from '../../src/server/tools/openResult.js';
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
    content: 'Extracted content from the selected search result page.',
    cleanedHtml: '<p>Extracted content from the selected search result page.</p>',
    textContent: 'Extracted content from the selected search result page.',
    title: 'Selected Article',
    byline: 'Author Name',
    excerpt: 'An excerpt from the article.',
    siteName: 'Example Site',
    language: 'en',
    author: 'Author Name',
    description: 'Article description.',
    publishedDate: '2025-06-01',
    imageUrl: null,
    canonicalUrl: null,
    score: 78,
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

const TWO_SEARCH_RESULTS: SearchResult[] = [
  { rank: 1, title: 'First Result', url: 'https://example.com/first', snippet: 'First snippet.' },
  { rank: 2, title: 'Second Result', url: 'https://example.com/second', snippet: 'Second snippet.' },
];

async function setup(
  config: AppConfig,
  provider: SearchProvider,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerOpenResultTool(server, config, provider);

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

describe('open_result tool', () => {
  beforeEach(() => {
    mockExtractUrl.mockReset();
  });

  it('lists open_result in available tools', async () => {
    const config = createMockConfig();
    const provider = createMockSearchProvider();
    const { client, cleanup } = await setup(config, provider);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('open_result');
    } finally {
      await cleanup();
    }
  });

  it('searches and extracts content from rank 1 result', async () => {
    const extraction = createMockExtractionResult({
      url: 'https://example.com/first',
      title: 'First Result Content',
    });
    mockExtractUrl.mockResolvedValueOnce(extraction);

    const config = createMockConfig();
    const provider = createMockSearchProvider(TWO_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'open_result',
        arguments: { query: 'test query', rank: 1 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);

      expect(parsed.query).toBe('test query');
      expect(parsed.selected_result.rank).toBe(1);
      expect(parsed.selected_result.title).toBe('First Result');
      expect(parsed.selected_result.url).toBe('https://example.com/first');
      expect(parsed.extraction.title).toBe('First Result Content');
      expect(parsed.extraction.extraction_score).toBe(78);
    } finally {
      await cleanup();
    }
  });

  it('searches and extracts content from rank 2 result', async () => {
    const extraction = createMockExtractionResult({
      url: 'https://example.com/second',
      title: 'Second Result Content',
    });
    mockExtractUrl.mockResolvedValueOnce(extraction);

    const config = createMockConfig();
    const provider = createMockSearchProvider(TWO_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'open_result',
        arguments: { query: 'test query', rank: 2 },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
      expect(parsed.selected_result.rank).toBe(2);
      expect(parsed.selected_result.url).toBe('https://example.com/second');
    } finally {
      await cleanup();
    }
  });

  it('returns isError when requested rank does not exist', async () => {
    const config = createMockConfig();
    const provider = createMockSearchProvider(TWO_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'open_result',
        arguments: { query: 'test query', rank: 5 },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toContain('SERP_NO_RESULTS');
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
        name: 'open_result',
        arguments: { query: 'test', rank: 1 },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toContain('Network error during search');
    } finally {
      await cleanup();
    }
  });

  it('returns isError when extraction fails after successful search', async () => {
    mockExtractUrl.mockRejectedValueOnce(new Error('Page load timeout'));

    const config = createMockConfig();
    const provider = createMockSearchProvider(TWO_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'open_result',
        arguments: { query: 'test query', rank: 1 },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toContain('Page load timeout');
    } finally {
      await cleanup();
    }
  });

  it('passes the correct URL from search result to extractUrl', async () => {
    mockExtractUrl.mockResolvedValueOnce(createMockExtractionResult());

    const config = createMockConfig();
    const provider = createMockSearchProvider(TWO_SEARCH_RESULTS);
    const { client, cleanup } = await setup(config, provider);
    try {
      await client.callTool({
        name: 'open_result',
        arguments: { query: 'test query', rank: 2 },
      });

      expect(mockExtractUrl).toHaveBeenCalledOnce();
      const [url] = mockExtractUrl.mock.calls[0]!;
      expect(url).toBe('https://example.com/second');
    } finally {
      await cleanup();
    }
  });

  it('returns isError when search returns empty results', async () => {
    const config = createMockConfig();
    const provider = createMockSearchProvider([]);
    const { client, cleanup } = await setup(config, provider);
    try {
      const result = await client.callTool({
        name: 'open_result',
        arguments: { query: 'obscure query', rank: 1 },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toContain('SERP_NO_RESULTS');
    } finally {
      await cleanup();
    }
  });
});
