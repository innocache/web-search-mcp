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
import { registerExtractUrlTool } from '../../src/server/tools/extractUrl.js';
import type { AppConfig } from '../../src/util/config.js';

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
    content: 'Extracted article content that is meaningful and long enough to be useful.',
    cleanedHtml: '<p>Extracted article content that is meaningful and long enough to be useful.</p>',
    textContent: 'Extracted article content that is meaningful and long enough to be useful.',
    title: 'Test Article',
    byline: 'Test Author',
    excerpt: 'A test article excerpt.',
    siteName: 'Example',
    language: 'en',
    author: 'Test Author',
    description: 'A test article.',
    publishedDate: '2025-01-01',
    imageUrl: 'https://example.com/image.jpg',
    canonicalUrl: 'https://example.com/article',
    score: 85,
    scoreLabel: 'excellent',
    weakExtraction: false,
    warnings: [],
    ...overrides,
  };
}

async function setup(config: AppConfig): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerExtractUrlTool(server, config);

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

describe('extract_url tool', () => {
  beforeEach(() => {
    mockExtractUrl.mockReset();
  });

  it('lists extract_url in available tools', async () => {
    const { client, cleanup } = await setup(createMockConfig());
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('extract_url');
    } finally {
      await cleanup();
    }
  });

  it('returns extraction result on success', async () => {
    const mockResult = createMockExtractionResult();
    mockExtractUrl.mockResolvedValueOnce(mockResult);

    const { client, cleanup } = await setup(createMockConfig());
    try {
      const result = await client.callTool({
        name: 'extract_url',
        arguments: { url: 'https://example.com/article' },
      });

      expect(result.isError).toBeFalsy();
      const textContent = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(textContent[0]!.text);

      expect(parsed.title).toBe('Test Article');
      expect(parsed.score).toBe(85);
      expect(parsed.scoreLabel).toBe('excellent');
      expect(parsed.url).toBe('https://example.com/article');
      expect(parsed.content).toContain('Extracted article content');
    } finally {
      await cleanup();
    }
  });

  it('passes output_format and max_chars to extractUrl', async () => {
    mockExtractUrl.mockResolvedValueOnce(createMockExtractionResult({ outputFormat: 'markdown' }));

    const config = createMockConfig();
    const { client, cleanup } = await setup(config);
    try {
      await client.callTool({
        name: 'extract_url',
        arguments: {
          url: 'https://example.com/page',
          output_format: 'markdown',
          max_chars: 5000,
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

  it('returns isError when extraction throws', async () => {
    mockExtractUrl.mockRejectedValueOnce(new Error('Navigation failed'));

    const { client, cleanup } = await setup(createMockConfig());
    try {
      const result = await client.callTool({
        name: 'extract_url',
        arguments: { url: 'https://broken.example.com' },
      });

      expect(result.isError).toBe(true);
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0]!.text).toContain('Navigation failed');
    } finally {
      await cleanup();
    }
  });

  it('includes warnings in successful extraction response', async () => {
    const mockResult = createMockExtractionResult({
      warnings: ['BOILERPLATE_REMOVED', 'LINK_DENSE_BLOCKS_REMOVED'],
      score: 55,
      scoreLabel: 'fair',
    });
    mockExtractUrl.mockResolvedValueOnce(mockResult);

    const { client, cleanup } = await setup(createMockConfig());
    try {
      const result = await client.callTool({
        name: 'extract_url',
        arguments: { url: 'https://example.com/noisy' },
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
      expect(parsed.warnings).toEqual(['BOILERPLATE_REMOVED', 'LINK_DENSE_BLOCKS_REMOVED']);
      expect(parsed.score).toBe(55);
    } finally {
      await cleanup();
    }
  });
});
