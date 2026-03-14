import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../../util/config.js';
import type { SearchProvider } from '../../search/SearchProvider.js';
import { createRequestLogger } from '../../util/logger.js';
import { wrapError } from '../../util/errors.js';

export function registerSearchWebTool(
  server: McpServer,
  config: AppConfig,
  searchProvider: SearchProvider,
): void {
  server.tool(
    'search_web',
    'Search the web and return normalized search results',
    {
      query: z.string().min(1).max(500),
      num_results: z.number().int().min(1).max(10).default(5),
      locale: z.string().optional(),
      region: z.string().optional(),
    },
    async (args) => {
      const log = createRequestLogger('search_web');
      log.info('Starting search', { query: args.query, num_results: args.num_results });

      try {
        const results = await searchProvider.search({
          query: args.query,
          numResults: Math.min(args.num_results, config.maxNumResults),
          locale: args.locale ?? config.searchLocale,
          region: args.region ?? config.searchRegion,
        });

        const output = {
          query: args.query,
          results,
        };

        log.done({ result_count: results.length });
        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        const wrapped = wrapError(err);
        log.error('Search failed', { error_code: wrapped.code });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: wrapped.toClientMessage() }],
        };
      }
    },
  );
}
