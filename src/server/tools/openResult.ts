import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../../util/config.js';
import type { SearchProvider } from '../../search/SearchProvider.js';
import { createRequestLogger } from '../../util/logger.js';
import { wrapError, ExtractionError } from '../../util/errors.js';
import { extractUrl } from '../../extraction/pipeline.js';

export function registerOpenResultTool(
  server: McpServer,
  config: AppConfig,
  searchProvider: SearchProvider,
): void {
  server.tool(
    'open_result',
    'Search the web and extract content from a specific ranked result',
    {
      query: z.string().min(1).max(500),
      rank: z.number().int().min(1).max(10).default(1),
      output_format: z.enum(['text', 'markdown', 'html']).default('text'),
      max_chars: z.number().int().min(100).max(100000).default(12000),
    },
    async (args) => {
      const log = createRequestLogger('open_result');
      log.info('Starting open_result', { query: args.query, rank: args.rank });

      try {
        const searchResults = await searchProvider.search({
          query: args.query,
          numResults: Math.max(args.rank, 5),
          locale: config.searchLocale,
          region: config.searchRegion,
        });

        const selectedResult = searchResults.find((r) => r.rank === args.rank);
        if (!selectedResult) {
          throw new ExtractionError(
            'SERP_NO_RESULTS',
            `No result found at rank ${args.rank}. Only ${searchResults.length} results returned.`,
          );
        }

        const extraction = await extractUrl(selectedResult.url, config, {
          outputFormat: args.output_format,
          maxChars: args.max_chars,
          timeoutMs: config.defaultTimeoutMs,
          waitUntil: 'load',
          settleMs: config.defaultSettleMs,
        });

        const output = {
          query: args.query,
          selected_result: {
            rank: selectedResult.rank,
            title: selectedResult.title,
            url: selectedResult.url,
            snippet: selectedResult.snippet,
          },
          extraction: {
            title: extraction.title,
            excerpt: extraction.excerpt,
            text: extraction.content,
            content_length: extraction.textContent.length,
            extraction_score: extraction.score,
          },
        };

        log.done({ result_count: 1, extraction_score: extraction.score });
        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        const wrapped = wrapError(err);
        log.error('open_result failed', { error_code: wrapped.code });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: wrapped.toClientMessage() }],
        };
      }
    },
  );
}
