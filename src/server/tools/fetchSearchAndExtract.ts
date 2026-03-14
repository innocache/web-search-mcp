import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../../util/config.js';
import type { SearchProvider } from '../../search/SearchProvider.js';
import { createRequestLogger } from '../../util/logger.js';
import { wrapError } from '../../util/errors.js';
import { extractUrl } from '../../extraction/pipeline.js';
import { Semaphore } from '../../browser/browserPool.js';

export function registerFetchSearchAndExtractTool(
  server: McpServer,
  config: AppConfig,
  searchProvider: SearchProvider,
): void {
  const extractionSemaphore = new Semaphore(config.browserConcurrency);

  server.tool(
    'fetch_search_and_extract',
    'Search the web and extract content from top results in a single call',
    {
      query: z.string().min(1).max(500),
      num_results: z.number().int().min(1).max(5).default(3),
      output_format: z.enum(['text', 'markdown', 'html']).default('text'),
      max_chars_per_result: z.number().int().min(100).max(50000).default(8000),
      timeout_ms: z.number().int().min(1000).max(60000).default(15000),
    },
    async (args) => {
      const log = createRequestLogger('fetch_search_and_extract');
      log.info('Starting search+extract', { query: args.query, num_results: args.num_results });

      try {
        const searchResults = await searchProvider.search({
          query: args.query,
          numResults: args.num_results,
          locale: config.searchLocale,
          region: config.searchRegion,
        });

        const extractionPromises = searchResults.map(async (result) => {
          await extractionSemaphore.acquire();
          try {
            const extraction = await extractUrl(result.url, config, {
              outputFormat: args.output_format,
              maxChars: args.max_chars_per_result,
              timeoutMs: args.timeout_ms,
              waitUntil: 'load',
              settleMs: config.defaultSettleMs,
            });
            return {
              rank: result.rank,
              url: result.url,
              title: extraction.title,
              excerpt: extraction.excerpt,
              text: extraction.content,
              content_length: extraction.textContent.length,
              extraction_score: extraction.score,
              warnings: extraction.warnings,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Extraction failed';
            return {
              rank: result.rank,
              url: result.url,
              title: result.title,
              content_length: 0,
              extraction_score: 0,
              warnings: [`EXTRACTION_FAILED: ${message}`],
            };
          } finally {
            extractionSemaphore.release();
          }
        });

        const extractedResults = await Promise.all(extractionPromises);
        extractedResults.sort((a, b) => a.rank - b.rank);

        const output = {
          query: args.query,
          search_results: searchResults.map((r) => ({
            rank: r.rank,
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          })),
          extracted_results: extractedResults,
        };

        log.done({
          result_count: searchResults.length,
          extraction_score: extractedResults[0]?.extraction_score,
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
      } catch (err) {
        const wrapped = wrapError(err);
        log.error('fetch_search_and_extract failed', { error_code: wrapped.code });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: wrapped.toClientMessage() }],
        };
      }
    },
  );
}
