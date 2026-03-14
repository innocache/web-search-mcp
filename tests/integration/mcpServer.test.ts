/// <reference types="vitest/globals" />
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerHealthCheckTool } from '../../src/server/tools/healthCheck.js';
import { registerSearchWebTool } from '../../src/server/tools/searchWeb.js';
import type { AppConfig } from '../../src/util/config.js';
import type { SearchProvider } from '../../src/search/SearchProvider.js';
import type { SearchResult } from '../../src/search/models.js';

function createMockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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

async function createTestServerAndClient(
  _config: AppConfig,
  _searchProvider: SearchProvider,
  registerTools: (server: McpServer) => void,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const cleanup = async () => {
    await client.close();
    await server.close();
  };

  return { client, cleanup };
}

describe('MCP Server integration', () => {
  describe('health_check tool', () => {
    it('lists health_check in available tools', async () => {
      const config = createMockConfig();
      const provider = createMockSearchProvider();
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerHealthCheckTool(server, provider),
      );

      try {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain('health_check');
      } finally {
        await cleanup();
      }
    });

    it('returns ok:true and search_provider:true when provider is available', async () => {
      const config = createMockConfig();
      const provider = createMockSearchProvider();
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerHealthCheckTool(server, provider),
      );

      try {
        const result = await client.callTool({ name: 'health_check', arguments: {} });
        expect(result.isError).toBeFalsy();

        const textContent = result.content as Array<{ type: string; text: string }>;
        expect(textContent).toHaveLength(1);
        expect(textContent[0]!.type).toBe('text');

        const parsed = JSON.parse(textContent[0]!.text);
        expect(parsed.ok).toBe(true);
        expect(parsed.version).toBe('1.0.0');
        expect(parsed.transport).toBe('stdio');
        expect(parsed.readiness.search_provider).toBe(true);
        expect(parsed.readiness.browser_extractor).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it('returns search_provider:false when provider throws', async () => {
      const config = createMockConfig();
      const provider: SearchProvider = {
        name: 'broken-provider',
        async search() {
          throw new Error('broken');
        },
        async isAvailable() {
          throw new Error('broken');
        },
      };
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerHealthCheckTool(server, provider),
      );

      try {
        const result = await client.callTool({ name: 'health_check', arguments: {} });
        const textContent = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(textContent[0]!.text);
        expect(parsed.ok).toBe(true);
        expect(parsed.readiness.search_provider).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });

  describe('search_web tool', () => {
    it('lists search_web in available tools', async () => {
      const config = createMockConfig();
      const provider = createMockSearchProvider();
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerSearchWebTool(server, config, provider),
      );

      try {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain('search_web');
      } finally {
        await cleanup();
      }
    });

    it('returns search results from provider', async () => {
      const mockResults: SearchResult[] = [
        {
          title: 'Test Result',
          url: 'https://example.com/test',
          snippet: 'A test search result snippet.',
          rank: 1,
        },
      ];
      const config = createMockConfig();
      const provider = createMockSearchProvider(mockResults);
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerSearchWebTool(server, config, provider),
      );

      try {
        const result = await client.callTool({
          name: 'search_web',
          arguments: { query: 'test query' },
        });
        expect(result.isError).toBeFalsy();

        const textContent = result.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(textContent[0]!.text);
        expect(parsed.query).toBe('test query');
        expect(parsed.results).toHaveLength(1);
        expect(parsed.results[0].title).toBe('Test Result');
        expect(parsed.results[0].url).toBe('https://example.com/test');
      } finally {
        await cleanup();
      }
    });

    it('returns isError when provider throws', async () => {
      const config = createMockConfig();
      const provider: SearchProvider = {
        name: 'failing-provider',
        async search() {
          throw new Error('Search failed: network timeout');
        },
        async isAvailable() {
          return false;
        },
      };
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => registerSearchWebTool(server, config, provider),
      );

      try {
        const result = await client.callTool({
          name: 'search_web',
          arguments: { query: 'test' },
        });
        expect(result.isError).toBe(true);
      } finally {
        await cleanup();
      }
    });
  });

  describe('multi-tool registration', () => {
    it('registers both health_check and search_web on one server', async () => {
      const config = createMockConfig();
      const provider = createMockSearchProvider();
      const { client, cleanup } = await createTestServerAndClient(
        config,
        provider,
        (server) => {
          registerHealthCheckTool(server, provider);
          registerSearchWebTool(server, config, provider);
        },
      );

      try {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain('health_check');
        expect(names).toContain('search_web');
        expect(tools.length).toBe(2);
      } finally {
        await cleanup();
      }
    });
  });
});
