/**
 * Manual end-to-end test — spawns the MCP server in Electron and calls
 * a tool (search, extract, or both). Supports direct URL extraction via
 * the extract_url tool.
 *
 * Run with --help for usage information.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── Help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  const bin = 'npx tsx scripts/manual-search-test.mts';
  console.error(`
web-search-mcp  Manual Search & Extract Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Spawns the Electron MCP server and runs a search, URL extraction, or both.
Summary prints to stderr; full JSON to stdout.

USAGE
  ${bin} <query-or-url> [options]
EXAMPLES
  ${bin} "what is MCP"
  ${bin} "rust vs go" --num 5 --format markdown
  ${bin} "react server components" --tool search_web
  ${bin} "best databases 2025" --tool open_result --rank 2
  ${bin} --tool extract_url https://example.com/article
  ${bin} --tool extract_url https://github.com/org/repo --format markdown --chars 12000
  ${bin} "climate change" --chars 12000 --timeout 30000
  ${bin} "AI news" > results.json          # pipe JSON to file
  ${bin} "AI news" | jq '.extracted_results[].title'
OPTIONS
  --tool <name>   Tool to invoke (default: fetch_search_and_extract)
                    fetch_search_and_extract  Search + extract top N results
                    search_web                Search only (no extraction)
                    open_result               Search + extract one ranked result
                    extract_url               Extract content from a single URL
  --num <n>       Number of results (1-5 for extract, 1-10 for search, default 3)
  --rank <n>      Which result to extract with open_result (default 1)
  --format <fmt>  Output format: text | markdown | html (default text)
  --chars <n>     Max characters per extracted result (default 8000)
  --timeout <ms>  Extraction timeout per URL in ms (default 15000)
  --settle <ms>   Post-load settle time in ms (default 1200)
  --help, -h      Show this help
OUTPUT
  stderr  Human-readable summary (extraction scores, content preview)
  stdout  Full JSON response (pipe to jq, file, etc.)
`.trim());
}

// ── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
  process.exit(0);
}
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args.splice(idx, 2)[1]!;
}
const numResults = parseInt(flag('num', '3'), 10);
const outputFormat = flag('format', 'text') as 'text' | 'markdown' | 'html';
const maxChars = parseInt(flag('chars', '8000'), 10);
const timeoutMs = parseInt(flag('timeout', '15000'), 10);
const settleMs = parseInt(flag('settle', '1200'), 10);
const toolName = flag('tool', 'fetch_search_and_extract');
const rank = parseInt(flag('rank', '1'), 10);
// Remaining non-flag args form the query (or URL for extract_url)
const positional = args.filter((a) => !a.startsWith('--')).join(' ').trim();
if (!positional) {
  printHelp();
  process.exit(1);
}

// ── Build project ───────────────────────────────────────────────────────────

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..');

console.error('[search-test] Building project...');
execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });

// ── Resolve Electron binary ─────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const electronPath: string = require('electron') as unknown as string;

console.error(`[search-test] Electron: ${electronPath}`);
if (toolName === 'extract_url') {
  console.error(`[search-test] URL: ${positional}`);
} else {
  console.error(`[search-test] Query: "${positional}"`);
}
console.error(`[search-test] Tool: ${toolName} | Format: ${outputFormat}`);
console.error('');

// ── Connect MCP client to Electron server ───────────────────────────────────

const transport = new StdioClientTransport({
  command: electronPath,
  args: [resolve(projectRoot, 'dist', 'index.js')],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    LOG_LEVEL: 'error',
  },
  stderr: 'pipe',
});

// Filter noisy Chromium cert/SSL warnings from stderr
const stderrStream = transport.stderr;
if (stderrStream) {
  let stderrBuf = '';
  stderrStream.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop()!;
    for (const line of lines) {
      if (
        line.includes('cert_issuer_source_aia') ||
        line.includes('Failed parsing Certificate') ||
        line.includes('ssl_client_socket_impl') ||
        line.includes('handshake failed; returned')
      ) continue;
      process.stderr.write(line + '\n');
    }
  });
  stderrStream.on('end', () => {
    if (stderrBuf.trim()) process.stderr.write(stderrBuf + '\n');
  });
}

const client = new Client({ name: 'manual-search-test', version: '1.0.0' });

try {
  await client.connect(transport);
  console.error('[search-test] Connected to MCP server');

  let toolArgs: Record<string, unknown>;

  switch (toolName) {
    case 'extract_url':
      toolArgs = {
        url: positional,
        output_format: outputFormat,
        max_chars: maxChars,
        timeout_ms: timeoutMs,
        settle_time_ms: settleMs,
      };
      break;
    case 'search_web':
      toolArgs = { query: positional, num_results: numResults };
      break;
    case 'open_result':
      toolArgs = {
        query: positional,
        rank,
        output_format: outputFormat,
        max_chars: maxChars,
      };
      break;
    case 'fetch_search_and_extract':
    default:
      toolArgs = {
        query: positional,
        num_results: numResults,
        output_format: outputFormat,
        max_chars_per_result: maxChars,
        timeout_ms: timeoutMs,
      };
      break;
  }

  console.error(`[search-test] Calling ${toolName}...`);
  const start = Date.now();

  const result = await client.callTool({ name: toolName, arguments: toolArgs });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.error(`[search-test] Done in ${elapsed}s`);
  console.error('');

  // Parse and pretty-print the result
  const content = result.content as Array<{ type: string; text: string }>;
  const parsed = JSON.parse(content[0]!.text);

  if (result.isError) {
    console.error('[search-test] ERROR:', parsed);
    process.exit(1);
  }

  // Print summary to stderr, full JSON to stdout
  if (parsed.search_results) {
    console.error('── Search Results ──');
    for (const r of parsed.search_results) {
      console.error(`  #${r.rank} ${r.title}`);
      console.error(`     ${r.url}`);
      if (r.snippet) console.error(`     ${r.snippet.slice(0, 120)}...`);
    }
    console.error('');
  }

  if (parsed.extracted_results) {
    console.error('── Extraction Summary ──');
    for (const r of parsed.extracted_results) {
      const status = r.extraction_score >= 65 ? '✅' : r.extraction_score > 0 ? '⚠️' : '❌';
      console.error(`  ${status} #${r.rank} score=${r.extraction_score} len=${r.content_length} ${r.url}`);
      if (r.warnings?.length) console.error(`     warnings: ${r.warnings.join(', ')}`);
    }
    console.error('');
  }

  if (parsed.extraction) {
    console.error('── Extraction ──');
    console.error(`  Score: ${parsed.extraction.extraction_score}`);
    console.error(`  Length: ${parsed.extraction.content_length}`);
    console.error('');
  }

  // extract_url returns fields at top level
  if (parsed.score !== undefined) {
    console.error('── Extraction ──');
    console.error(`  Title:   ${parsed.title || '(none)'}`);
    console.error(`  Byline:  ${parsed.byline || '(none)'}`);
    console.error(`  Excerpt: ${(parsed.excerpt || '(none)').slice(0, 120)}`);
    console.error(`  Score:   ${parsed.score} / 100 (${parsed.scoreLabel})`);
    const textLen = parsed.textContent?.length ?? parsed.content?.length ?? 0;
    console.error(`  Length:  ${textLen} chars`);
    if (parsed.warnings?.length) {
      console.error(`  Warnings: ${parsed.warnings.join(', ')}`);
    }
    console.error('');
    // Print a content preview to stderr
    const preview = (parsed.content || '').slice(0, 500);
    if (preview) {
      console.error('── Content Preview (first 500 chars) ──');
      console.error(preview);
      console.error('');
    }
  }

  // Full output to stdout (pipeable)
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.error('[search-test] Fatal:', err);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}