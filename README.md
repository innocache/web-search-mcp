# web-search-mcp

A production-grade Model Context Protocol (MCP) server that provides web search and content extraction tools to LLMs. Uses Electron BrowserWindow for real Chromium rendering and Mozilla Readability for high-fidelity content extraction.

## Features

- **5 MCP Tools**: `search_web`, `extract_url`, `open_result`, `fetch_search_and_extract`, `health_check`
- **Real Browser Rendering**: Electron BrowserWindow handles JavaScript-heavy pages, SPAs, and CSR content
- **High-Quality Extraction**: 5-stage pipeline with pre/post cleanup, Readability, and quality scoring (0-100)
- **3 Output Formats**: Plain text, Markdown, and sanitized HTML
- **Google SERP Scraping**: Direct scraping with anti-detection (User-Agent rotation, random delays, block detection)
- **Security Hardened**: Sandboxed renderer, SSRF protection, protocol allowlist, permission denial

## Prerequisites

- **Node.js** >= 18.0.0
- **npm**
- **Electron** (installed as a dependency)

## Quickstart

```bash
# Install dependencies
npm install

# Build (compiles TypeScript + bundles Readability)
npm run build

# Run the MCP server (stdio transport)
npm start
```

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "web-search": {
      "command": "electron",
      "args": ["./dist/index.js"],
      "cwd": "/path/to/web-search-mcp"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "npx",
      "args": ["electron", "./dist/index.js"],
      "cwd": "/path/to/web-search-mcp"
    }
  }
}
```

## Tools

### `search_web`

Search the web and return normalized search results.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Search query (1-500 chars) |
| `num_results` | number | 5 | Number of results (1-10) |
| `locale` | string | `en-US` | Language for search results |
| `region` | string | `us` | Region for search results |

### `extract_url`

Load a URL in a real browser and extract its readable main content.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | (required) | URL to extract |
| `output_format` | enum | `text` | `text`, `markdown`, or `html` |
| `max_chars` | number | 12000 | Max output characters (100-100000) |
| `timeout_ms` | number | 15000 | Navigation timeout (1000-60000) |
| `wait_until` | enum | `load` | `load`, `domcontentloaded`, or `network-idle-like` |
| `settle_time_ms` | number | 1200 | Post-load settle time (0-30000) |

### `open_result`

Search the web and extract content from a specific ranked result.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Search query (1-500 chars) |
| `rank` | number | 1 | Result rank to extract (1-10) |
| `output_format` | enum | `text` | `text`, `markdown`, or `html` |
| `max_chars` | number | 12000 | Max output characters (100-100000) |

### `fetch_search_and_extract`

Search the web and extract content from top results in a single call.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Search query (1-500 chars) |
| `num_results` | number | 3 | Results to extract (1-5) |
| `output_format` | enum | `text` | `text`, `markdown`, or `html` |
| `max_chars_per_result` | number | 8000 | Max chars per result (100-50000) |
| `timeout_ms` | number | 15000 | Timeout per extraction (1000-60000) |

### `health_check`

Check server health and readiness. No parameters.

## Architecture

The server follows a 4-layer architecture:

```
MCP Client (LLM)
    |  stdio
    v
+-- Layer A: MCP Server --------+
|   Tool registration, Zod      |
|   validation, error mapping   |
+------+----------------+-------+
       |                |
       v                v
+-- Layer B ----+  +-- Extraction Pipeline --+
| Search        |  | Stage 1: Metadata       |
| Provider      |  | Stage 2: DOM Cleanup    |
| (Google SERP) |  | Stage 3: Readability    |
+------+--------+  | Stage 4: Post-Cleanup   |
       |            | Stage 5: Normalization  |
       v            +------+-----------------+
+-- Layer C: Electron BrowserWindow ---------+
|   Sandboxed, session-isolated, resource-   |
|   blocked, SSRF-protected                  |
+--------------------------------------------+
       |
       v
+-- Layer D: Content Normalization ----------+
|   Text / Markdown / HTML output            |
+--------------------------------------------+
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full technical deep-dive.

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_PROVIDER` | `google-scraping` | Search backend |
| `SEARCH_LOCALE` | `en-US` | Search language |
| `SEARCH_REGION` | `us` | Search region |
| `DEFAULT_NUM_RESULTS` | `5` | Default search result count |
| `MAX_NUM_RESULTS` | `10` | Maximum search results |
| `DEFAULT_TIMEOUT_MS` | `15000` | Navigation timeout (ms) |
| `DEFAULT_SETTLE_MS` | `1200` | Post-load settle time (ms) |
| `MAX_CHARS_DEFAULT` | `12000` | Default max output characters |
| `BROWSER_CONCURRENCY` | `2` | Simultaneous extraction windows |
| `LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `RESOURCE_BLOCK_IMAGES` | `true` | Block image loading |
| `RESOURCE_BLOCK_MEDIA` | `true` | Block media loading |
| `RESOURCE_BLOCK_FONTS` | `true` | Block font loading |
| `HEADLESS_MODE` | `true` | Run Electron headless |
| `SEARCH_MIN_DELAY_MS` | `2000` | Min delay between searches |
| `SEARCH_MAX_DELAY_MS` | `5000` | Max delay between searches |

## Testing

```bash
# Unit + integration tests (226 tests, vitest)
npm test

# E2E component tests (35 tests, vitest + mocked Electron)
npm run test:e2e

# Real-Electron tests (16 tests, standalone runner)
npm run test:e2e:electron

# All tests combined
npm run test:all

# Quality audit (12 real URLs, extraction scoring)
npx tsx scripts/run-quality-audit.mts

# Manual search test
npx tsx scripts/manual-search-test.mts --help
npx tsx scripts/manual-search-test.mts "your search query"
npx tsx scripts/manual-search-test.mts --tool extract_url https://example.com/article
```

See [docs/TESTING.md](docs/TESTING.md) for the full testing guide.

## Quality

Extraction quality is measured via a scoring algorithm (0-100) and validated against 12 diverse real-world URLs. Current pass rate: **83% (10/12 Tier A URLs)**.

| Site | Score | Status |
|------|-------|--------|
| AP News | 90 | Pass |
| BBC News | 93 | Pass |
| GitHub Blog | 100 | Pass |
| MDN | 91 | Pass |
| Wikipedia | 88 | Pass |
| Paul Graham | 81 | Pass |
| NYT | 81 | Pass |
| Dev.to | 96 | Pass |
| Reddit | 70 | Pass |
| Medium (Freedium) | 81 | Pass |
| Reuters (hub page) | -- | Expected fail |
| Substack (paywall) | -- | Expected fail |

See [docs/QUALITY.md](docs/QUALITY.md) for the scoring algorithm and methodology.

## Project Structure

```
web-search-mcp/
  src/
    index.ts                    # Electron entry point
    server/
      mcpServer.ts              # MCP server factory, tool registration
      tools/                    # 5 tool handlers
    extraction/
      pipeline.ts               # 5-stage extraction pipeline
      selectorConfig.ts         # 3-tier CSS selector system
      postCleanup.ts            # Post-Readability noise removal
      qualityScore.ts           # Extraction quality scoring
      metadataExtractor.ts      # JSON-LD, OG, meta extraction
      pageSettler.ts            # CSR-aware page settling
      readabilityRunner.ts      # Readability.js execution
    search/
      SearchProvider.ts         # Provider interface
      providers/                # Google scraping implementation
      parsers/                  # SERP HTML parser
    browser/
      browserPool.ts            # Semaphore concurrency control
      windowFactory.ts          # BrowserWindow creation
      serpWindow.ts             # SERP-specific window
      resourcePolicy.ts         # Image/media/font blocking
    normalize/
      text.ts                   # Plain text normalization
      markdownLite.ts           # Markdown conversion
      html.ts                   # HTML sanitization
    util/
      config.ts                 # Environment configuration
      logger.ts                 # Structured logging
      errors.ts                 # Typed error codes
      securityPolicy.ts         # SSRF, protocol, permission policies
      timeouts.ts               # Timeout utilities
      url.ts                    # URL validation
      userAgent.ts              # UA rotation
  tests/
    unit/                       # 226 unit tests
    e2e/                        # 35 E2E component tests
    integration/                # MCP server integration tests
    fixtures/                   # HTML test fixtures
  scripts/
    manual-search-test.mts      # Ad-hoc search testing
    run-quality-audit.mts       # Quality audit launcher
    run-electron-tests.mts      # Electron test launcher
    refresh-fixtures.mts        # Fixture generator
    bundle-readability.mjs      # Readability IIFE bundler
  vendor/
    readability.iife.js         # Bundled Readability for renderer injection
  docs/
    ARCHITECTURE.md             # Technical architecture deep-dive
    TESTING.md                  # Testing guide
    QUALITY.md                  # Quality methodology
```

## Documentation

| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, code style, contribution workflow |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 4-layer architecture, extraction pipeline, concurrency model |
| [docs/TESTING.md](docs/TESTING.md) | Two-layer test strategy, fixture management, CI integration |
| [docs/QUALITY.md](docs/QUALITY.md) | Scoring algorithm, selector system, audit methodology |
| [HISTORY.md](HISTORY.md) | Project development history and decision log |

## License

MIT
