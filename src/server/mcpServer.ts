import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSearchWebTool } from './tools/searchWeb.js';
import { registerExtractUrlTool } from './tools/extractUrl.js';
import { registerOpenResultTool } from './tools/openResult.js';
import { registerFetchSearchAndExtractTool } from './tools/fetchSearchAndExtract.js';
import { registerHealthCheckTool } from './tools/healthCheck.js';
import type { AppConfig } from '../util/config.js';
import type { SearchProvider } from '../search/SearchProvider.js';
import { logStartup } from '../util/logger.js';

export async function createMcpServer(config: AppConfig, searchProvider: SearchProvider): Promise<void> {
  const server = new McpServer({
    name: 'web-search-mcp',
    version: '1.0.0',
  });

  registerSearchWebTool(server, config, searchProvider);
  registerExtractUrlTool(server, config);
  registerOpenResultTool(server, config, searchProvider);
  registerFetchSearchAndExtractTool(server, config, searchProvider);
  registerHealthCheckTool(server, searchProvider);

  const transport = new StdioServerTransport();
  logStartup('MCP server connecting via stdio');
  await server.connect(transport);
  logStartup('MCP server connected and ready');
}
