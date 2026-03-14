# Project History

Chronological record of all design discussions, decisions, pivots, and implementation phases for the web-search-mcp project.

---

## Phase 1: Specification Design

### Session Start — Agent.md Brainstorm

The project began with a collaborative review of `Agent.md`, which defined the high-level objective: build a production-grade MCP server in TypeScript that runs over stdio and exposes web-search and content-extraction tools.

Key requirements identified:
- Use the official MCP TypeScript SDK with stdio transport
- Use Electron BrowserWindow for real Chromium page rendering
- Use Mozilla Readability for content extraction
- Treat remote pages as untrusted
- Return structured, LLM-friendly JSON outputs

### Search Provider Decision

**Options considered:**
1. API-based providers (Brave Search, Google CSE, Serper, SearXNG)
2. Direct SERP scraping via Electron

**Decision: Direct Google SERP scraping.** Rationale:
- Zero external API dependencies and zero cost
- Electron is already in the stack — reuse BrowserWindow infrastructure
- Best result quality (full Google results, not filtered API subsets)
- The swappable `SearchProvider` interface means API providers can be added later

### SERP Parsing Strategy

Chose structural DOM patterns over class-name selectors because Google obfuscates and frequently changes CSS classes. The parser targets `<a>` tags containing `<h3>` elements, unwraps Google's `/url?q=` redirect wrapper, and skips ads/knowledge panels/PAA boxes.

### Agent.md — Initial Draft

The spec was written as a comprehensive 1519-line document covering:
- 5 MCP tools (search_web, extract_url, open_result, fetch_search_and_extract, health_check)
- 5-stage extraction pipeline
- 3-tier DOM cleanup system
- Quality scoring algorithm
- Security model (protocol allowlist, SSRF protection, permission denial, popup/download blocking)
- Concurrency model (Semaphore + Mutex with dedicated SERP slot)
- Configuration via environment variables
- Testing requirements

---

## Phase 2: Specification Refinement

### Content Quality Focus

A dedicated review focused on extraction quality — ensuring the output contains no generic content such as ads, headers, footers, page directories, cookie banners, newsletter signup blocks, or related-link sections.

This led to a **full rewrite of the extraction sections** in Agent.md, producing:
- Tier 1: ~60 exact CSS selectors for unconditional removal (scripts, ads, nav, cookie banners, social share, sidebar, popups, newsletters, related content, comments)
- Tier 2: ~80 partial class/id substring patterns for moderate-confidence removal
- Tier 3: Preserve rules to protect content containers (article, main, figure, code, blockquote, table, media)
- Execution order: preserve-mark ancestors, exact remove, partial remove, hidden elements, lazy-load resolution, SVG cleanup, empty container pruning

### Spec Quality Audit

An Oracle-assisted review of the full Agent.md identified 14 issues across categories:
- Missing abort conditions in the pipeline
- Unspecified process boundaries (renderer vs. main process)
- Missing Readability bundling mechanism
- Unclear fallback extraction behavior
- Security gaps (isolated world execution, certificate error handling)
- Concurrency model clarification (SERP mutex vs. extraction semaphore)

**All 14 fixes were applied**, bringing Agent.md to its final form (1519 lines). The spec was then frozen — no further modifications.

---

## Phase 3: Core Implementation

Implementation was delegated to specialized agents across multiple parallel work streams.

### Extraction Pipeline (Deep Agent)
- Built the 5-stage pipeline in `src/extraction/pipeline.ts`
- Stages 1-3 run as a single `executeJavaScript` IIFE in the BrowserWindow renderer
- Stages 4-5 run in the Node.js main process on Readability's HTML string output
- Readability is pre-bundled as an IIFE via esbuild at build time (`scripts/bundle-readability.mjs`)

### Search Layer (Deep Agent)
- Implemented `SearchProvider` interface with `GoogleScrapingProvider`
- SERP parser extracts title, URL (unwrapped from Google redirect), snippet, display URL
- Anti-detection: realistic User-Agent, Accept-Language, 1920x1080 viewport, fresh session partitions
- Rate limiting with configurable min/max delay between searches
- Block detection: CAPTCHA elements, `/sorry/` URLs, HTTP 429, zero results from non-empty pages

### Normalization Layer (Deep Agent)
- Text mode: NFKC normalization, whitespace collapse, max 2 blank lines
- Markdown-lite mode: lightweight HTML-to-Markdown converter handling headings, links, bold/italic, code blocks, lists, blockquotes, images, tables
- HTML mode: attribute stripping (class/id/style/data-*), preserving src/href/alt/title

### Browser Layer
- `browserPool.ts`: Counting Semaphore (configurable capacity) + Mutex for SERP
- `windowFactory.ts`: Creates hardened BrowserWindows (show:false, sandbox:true, contextIsolation:true, nodeIntegration:false)
- `serpWindow.ts`: Dedicated SERP BrowserWindow with fresh non-persistent session per search
- `resourcePolicy.ts`: Blocks images/media/fonts/trackers via session.webRequest
- `securityPolicy.ts`: Protocol allowlist, SSRF protection, permission denial, popup blocking, download cancellation

### MCP Server
- Tool registration via `McpServer.registerTool()` with Zod input schemas
- Stdio transport via `StdioServerTransport`
- Graceful shutdown (SIGINT, SIGTERM, EPIPE on stdout)
- All logging to stderr only

---

## Phase 4: Test Suite

### Unit + Integration Tests (226 tests)
Written across 18 test files covering:
- Each extraction pipeline stage independently
- Quality scoring algorithm
- Post-cleanup (boilerplate, link density, empty nodes)
- Normalization (text, markdown, html)
- SERP parser (title/URL/snippet extraction, ad filtering, redirect unwrapping)
- Browser pool (Semaphore, Mutex)
- Utilities (URL validation, SSRF checks, timeouts, error wrapping)
- MCP server integration (tool registration, health check)

### E2E Component Tests (35 tests)
Full pipeline tests using HTML fixtures — noisy input through all 5 stages producing clean output. Verifies no nav/footer/ads/cookies survive extraction.

### Test Fixture Design

**Two-layer test strategy:**
- **Layer 1 (Deterministic):** Hand-crafted HTML fixtures for unit and e2e tests — fast, reproducible, CI-safe
- **Layer 2 (Real-world):** Electron-based tests hitting live URLs — validates extraction quality on diverse real pages

This design was chosen because:
- Real web pages are too diverse and change too frequently for deterministic tests
- But purely synthetic fixtures can't catch real-world extraction failures
- The two layers complement each other: Layer 1 for correctness, Layer 2 for quality validation

### Layer 2 Test Strategy Decision

**Options considered:**
1. Use Google Trends API for dynamic keyword selection + top search results
2. Hand-crafted fixture URLs covering diverse page types

**Decision: Both approaches.** Layer 1 uses hand-crafted fixtures for determinism. Layer 2 uses a curated set of 12 Tier A URLs representing diverse page types (news, blogs, docs, wikis, forums, hub pages).

---

## Phase 5: Electron Runtime Setup

Setting up the Electron test runtime required significant iteration:

### BrowserWindow Crash Debugging
Oracle consultation diagnosed BrowserWindow creation failures — the issue was Electron's `app.whenReady()` lifecycle not being properly awaited before window creation.

### Test Runner Architecture
Standard vitest cannot run inside Electron's main process. A standalone test runner was built:
- `scripts/electron-test-main.mjs` — runs as Electron's main entry, executes tests, reports results
- `scripts/run-electron-tests.mts` — spawns Electron with the test runner

### 16 Real-Electron Tests
All passing, covering:
- BrowserWindow creation and destruction
- Page loading and content extraction
- Session isolation verification
- Resource policy enforcement
- Full extraction pipeline on live pages

---

## Phase 6: Quality Audit

### Initial Audit
First quality audit revealed issues with several sites:
- Reddit: Bot detection blocking content
- Medium: Paywall blocking extraction
- StackOverflow: Inconsistent extraction quality

### Reddit Solution
Switched from `old.reddit.com` to `www.reddit.com` — the modern Reddit frontend loads content better with JavaScript rendering in Electron.

**Tested URL:** `https://www.reddit.com/r/LocalLLaMA/comments/1rpw17y/ryzen_ai_max_395_128gb_qwen_35_35b122b_benchmarks/`

### Medium Solution
Used Freedium mirror (`freedium-mirror.cfd`) to bypass Medium's paywall. This provides full article content without subscriber authentication.

**Tested URL:** Via freedium-mirror.cfd proxy of the original Medium article.

### URL Roster Changes
- Removed Linear.app (requires authentication)
- Removed Substack (subscriber-only content) — replaced with Pragmatic Engineer blog
- Added Pragmatic Engineer: `https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development`

### CSR-Aware Page Settling
Oracle-designed adaptive page settling for CSR (Client-Side Rendered) pages:
- Monitors DOM mutation count, text content length, and network activity
- Fast-path: if page already has substantial text content, skip extended waiting
- Stability detection: waits until DOM mutations and text length stabilize
- Network-idle-like mode: waits for outstanding network requests to settle

### Final Audit Results (10/12 Tier A Pass, 83%)

| URL | Score | Status |
|-----|-------|--------|
| AP News | 90 | Pass |
| BBC News | 93 | Pass |
| GitHub Blog | 100 | Pass |
| MDN Promise | 91 | Pass |
| Wikipedia (LLM) | 88 | Pass |
| Paul Graham | 81 | Pass |
| NYT homepage | 81 | Pass |
| Dev.to | 96 | Pass |
| Reddit (LocalLLaMA) | 70 | Pass |
| Medium (Freedium) | 81 | Pass |
| Reuters (index) | — | Expected fail (hub page, no single article) |
| Substack (Pragmatic Eng) | — | Expected fail (subscriber-only paywall) |

Zero noise detected across all successful extractions — no ads, headers, footers, navigation, cookie banners, or unrelated content in any output.

---

## Phase 7: Cleanup and Polish

### Dead Code Removal
Identified and deleted 4 files (368 lines) of unused code:
- `src/extraction/domCleanup.ts` (163 lines) — superseded by inline renderer script in pipeline.ts
- `src/extraction/types.ts` (15 lines) — types moved to their respective modules
- `src/util/validation.ts` (35 lines) — validation consolidated into url.ts
- `scripts/debug-load.mjs` (155 lines) — debug script no longer needed

Verified all tests still pass after deletion.

### Manual Search Test Script
Created `scripts/manual-search-test.mts` for ad-hoc real-world testing:
- Spawns the Electron MCP server as a child process
- Connects via MCP SDK client over stdio
- Supports all 3 search tools: `fetch_search_and_extract`, `search_web`, `open_result`
- Filters noisy Chromium cert/SSL warnings from stderr
- Outputs human-readable summary to stderr, full JSON to stdout (pipeable)
- Full `--help` flag with usage examples

### Chromium Certificate Warnings
During manual testing, Chromium cert_issuer_source_aia errors appeared. Investigation (with Oracle consultation) confirmed these are harmless internal Chromium warnings from network/DNS filtering (OpenDNS) — TLS handshakes still succeed. The manual test script filters these from stderr output.

---

## Phase 8: Documentation

Created comprehensive project documentation:
- `HISTORY.md` — This file (project discussion history)
- `README.md` — Project overview, quickstart, architecture, API reference
- `CONTRIBUTING.md` — Developer setup, code style, testing, contribution workflow
- `docs/ARCHITECTURE.md` — Deep dive into system architecture and data flow
- `docs/TESTING.md` — Two-layer test strategy, fixtures, quality audit process
- `docs/QUALITY.md` — Extraction quality methodology, scoring algorithm, audit results

---

## Key Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search provider | Google SERP scraping | Zero cost, zero dependencies, best quality, Electron already available |
| SERP parsing | Structural DOM patterns | Google obfuscates class names; `<a>` + `<h3>` structure is stable |
| Page rendering | Electron BrowserWindow | Real Chromium rendering handles CSR/JS-heavy pages |
| Content extraction | Mozilla Readability | Industry standard, handles diverse page layouts well |
| Pre-cleanup approach | 3-tier selector system | Balances aggressive noise removal with content preservation |
| Session isolation | Fresh non-persistent partition per request | True isolation without complex clearStorageData calls |
| Concurrency | Semaphore + dedicated SERP Mutex | Prevents deadlock when search and extraction compete for windows |
| Test strategy | Two-layer (fixtures + real pages) | Determinism for CI + real-world validation for quality |
| Readability bundling | Pre-built IIFE via esbuild | Avoids runtime CDN fetches, injected via executeJavaScript |
| Output formats | text, markdown-lite, html | Covers LLM consumption (text), human reading (markdown), and raw output (html) |

---

## Compacted Context Summary

This section preserves the essential state from all prior conversation context compressions.

### Project Identity
- **Name:** web-search-mcp
- **Type:** MCP server (Model Context Protocol)
- **Language:** TypeScript (ES2022, Node16 modules)
- **Runtime:** Electron (for BrowserWindow rendering)
- **Transport:** stdio (stdin/stdout for MCP protocol, stderr for logging)

### Source Structure
```
src/
  index.ts                          # Electron entry point
  server/
    mcpServer.ts                    # MCP server factory, registers 5 tools
    tools/                          # Tool handlers: searchWeb, extractUrl, openResult,
                                    #   fetchSearchAndExtract, healthCheck
  extraction/
    pipeline.ts                     # 5-stage extraction pipeline (815 lines)
    selectorConfig.ts               # 3-tier selector lists
    metadataExtractor.ts            # Stage 1: JSON-LD, OG, meta
    readabilityRunner.ts            # Stage 3: Readability types
    postCleanup.ts                  # Stage 4: boilerplate, link density, empty nodes
    qualityScore.ts                 # Score computation (0-100)
    pageSettler.ts                  # CSR-aware adaptive page settling
  search/
    SearchProvider.ts               # Provider interface
    providers/googleScrapingProvider.ts  # Default: SERP scraping via Electron
    parsers/googleSerpParser.ts     # DOM-based SERP result extraction
    models.ts                       # Search result types
  browser/
    browserPool.ts                  # Semaphore + Mutex
    windowFactory.ts                # Hardened BrowserWindow creation
    serpWindow.ts                   # Dedicated SERP window
    resourcePolicy.ts              # Image/media/font/tracker blocking
  normalize/
    text.ts                         # Text mode: NFKC, whitespace normalization
    markdownLite.ts                 # Markdown-lite converter
    html.ts                         # HTML attribute stripping
  util/
    config.ts                       # Environment variable configuration
    errors.ts                       # Typed error codes
    logger.ts                       # stderr-only logging
    securityPolicy.ts               # Protocol/SSRF/permission policies
    timeouts.ts                     # Promise timeout wrapper
    url.ts                          # URL validation + SSRF checks
    userAgent.ts                    # Realistic UA generation
```

### Test Suite
- 226 unit/integration tests (vitest, 18 files)
- 35 mock e2e tests (vitest with e2e config)
- 16 real-Electron tests (standalone runner)
- All passing

### Scripts
- `manual-search-test.mts` — Real Google search via MCP client (supports --help)
- `quality-audit-main.mjs` / `run-quality-audit.mts` — Extraction quality audit
- `electron-test-main.mjs` / `run-electron-tests.mts` — Electron test runner
- `refresh-fixtures.mts` — Regenerate HTML fixtures
- `bundle-readability.mjs` — Bundle Readability.js as IIFE

### Configuration (Environment Variables)
| Variable | Default | Description |
|----------|---------|-------------|
| SEARCH_PROVIDER | google-scraping | Search backend |
| SEARCH_LOCALE | en-US | Search locale |
| SEARCH_REGION | us | Search region |
| DEFAULT_NUM_RESULTS | 5 | Default result count |
| MAX_NUM_RESULTS | 10 | Maximum results |
| DEFAULT_TIMEOUT_MS | 15000 | Extraction timeout |
| DEFAULT_SETTLE_MS | 1200 | Page settle delay |
| MAX_CHARS_DEFAULT | 12000 | Max content chars |
| BROWSER_CONCURRENCY | 2 | Extraction pool size |
| LOG_LEVEL | info | Log verbosity |
| RESOURCE_BLOCK_IMAGES | true | Block image loading |
| RESOURCE_BLOCK_MEDIA | true | Block media loading |
| RESOURCE_BLOCK_FONTS | true | Block font loading |
| HEADLESS_MODE | true | Hidden windows |
| SEARCH_MIN_DELAY_MS | 2000 | Min delay between searches |
| SEARCH_MAX_DELAY_MS | 5000 | Max delay between searches |

### Quality Scoring
- 0-100 scale based on: text length (0-40), sentence density (0-25), link density penalty (0 to -20), boilerplate penalty (0 to -15), metadata bonuses (0-20), Readability success (+15)
- Labels: >=85 excellent, >=70 good, >=50 fair, >=30 poor, else failed
- Weak extraction: score < 45, or short + link-heavy, or textLength < 120

### Spec Status
- `Agent.md`: 1519 lines, frozen (DO NOT MODIFY)
- All 10 acceptance criteria met
- v2 nice-to-haves documented but not implemented
