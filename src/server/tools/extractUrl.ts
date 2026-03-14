import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../../util/config.js';
import { createRequestLogger } from '../../util/logger.js';
import { wrapError } from '../../util/errors.js';
import { extractUrl } from '../../extraction/pipeline.js';

export function registerExtractUrlTool(
  server: McpServer,
  config: AppConfig,
): void {
  server.tool(
    'extract_url',
    'Load a URL and extract its readable main content',
    {
      url: z.string().url(),
      output_format: z.enum(['text', 'markdown', 'html']).default('text'),
      max_chars: z.number().int().min(100).max(100000).default(12000),
      timeout_ms: z.number().int().min(1000).max(60000).default(15000),
      wait_until: z.enum(['load', 'domcontentloaded', 'network-idle-like']).default('load'),
      settle_time_ms: z.number().int().min(0).max(30000).default(1200),
    },
    async (args) => {
      const log = createRequestLogger('extract_url');
      log.info('Starting extraction', { url: args.url, output_format: args.output_format });

      try {
        const result = await extractUrl(args.url, config, {
          outputFormat: args.output_format,
          maxChars: args.max_chars,
          timeoutMs: args.timeout_ms,
          waitUntil: args.wait_until,
          settleMs: args.settle_time_ms,
        });

        log.done({
          url: args.url,
          extraction_score: result.score,
          warning_count: result.warnings.length,
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const wrapped = wrapError(err);
        log.error('Extraction failed', { url: args.url, error_code: wrapped.code });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: wrapped.toClientMessage() }],
        };
      }
    },
  );
}
