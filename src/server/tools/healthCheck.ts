import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SearchProvider } from '../../search/SearchProvider.js';

export function registerHealthCheckTool(
  server: McpServer,
  searchProvider: SearchProvider,
): void {
  server.tool(
    'health_check',
    'Check server health and readiness',
    {},
    async () => {
      let searchAvailable = false;
      try {
        searchAvailable = await searchProvider.isAvailable();
      } catch {
        searchAvailable = false;
      }

      const output = {
        ok: true,
        version: '1.0.0',
        transport: 'stdio',
        electron_available: true,
        readiness: {
          search_provider: searchAvailable,
          browser_extractor: true,
        },
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
    },
  );
}
