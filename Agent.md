# Agent.md — Spec for a Web Search MCP Server (TypeScript, stdio)

## 1. Objective

Design and implement a production-minded **Model Context Protocol (MCP) server** in **TypeScript** that runs over **stdio** and exposes tools for:

1. searching the web,
2. opening search results,
3. extracting the main readable content from destination pages,
4. trimming common web-page noise such as ads, headers, footers, sidebars, cookie banners, and related-link blocks,
5. returning structured, LLM-friendly results.

The server is intended for use by MCP-compatible clients and AI coding agents.

---

## 2. Core Design Principles

- Use the **official MCP TypeScript SDK**.
- Run over **stdio**.
- Use **Electron BrowserWindow** to load remote pages in a real Chromium renderer.
- Use **Mozilla Readability** on the rendered DOM to extract main content.
- Treat remote pages as **untrusted**.
- Separate **SERP parsing** from **destination-page extraction**.
- Return **structured JSON-friendly outputs** optimized for LLMs.
- Prefer modularity so the search backend can be swapped later.

---

## 3. Scope

### In scope
- stdio MCP server
- web search tool
- destination-page extraction tool
- DOM cleanup / boilerplate trimming
- hidden hardened BrowserWindow loading
- structured tool outputs
- timeout/error handling
- testable modular implementation

### Out of scope for v1
- GUI
- screenshot/PDF/OCR workflows
- CAPTCHA solving
- arbitrary browser automation
- login persistence across runs
- vector DB / indexing
- Streamable HTTP transport
- distributed crawling

---

## 4. Primary Use Cases

### Use case A: search only
1. MCP client invokes `search_web`
2. server returns normalized result cards

### Use case B: extract one result
1. MCP client invokes `open_result`
2. server searches
3. server opens the selected result in a hidden BrowserWindow
4. server cleans the DOM and runs Readability
5. server returns cleaned content

### Use case C: single-call search + extraction
1. MCP client invokes `fetch_search_and_extract`
2. server searches
3. server extracts top N results
4. server returns both search results and cleaned article content

---

## 5. Required Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js LTS
- **Transport:** stdio
- **Core libraries:**
  - MCP TypeScript SDK
  - Electron
  - `@mozilla/readability`
  - schema validation library such as `zod`
  - test framework such as `vitest` or `jest`

Optional helper libraries are allowed if they improve reliability, testing, or parsing.

---

## 6. High-Level Architecture

The system should be split into these layers.

### A. MCP server layer
Responsibilities:
- initialize MCP server
- register tools
- validate inputs
- format outputs
- handle stdio lifecycle
- map internal errors to MCP-friendly tool errors

### B. Search provider layer
Responsibilities:
- perform web search
- parse search result pages or provider output
- normalize results into a consistent schema

### C. Browser extraction layer
Responsibilities:
- create hidden BrowserWindow instances
- isolate sessions/partitions
- apply resource-blocking policies
- wait for page load and settle
- execute DOM cleanup and Readability
- score extraction quality
- return cleaned content

### D. Content normalization layer
Responsibilities:
- normalize text/HTML output
- trim repeated whitespace
- truncate to limits
- support text and markdown-lite output modes

---

## 7. MCP Transport Requirements

The server must:

- communicate via **stdin/stdout** using MCP stdio transport,
- log only to **stderr**,
- never write non-protocol output to stdout,
- shut down cleanly if stdio closes unexpectedly,
- handle broken pipes defensively.

### Launch expectation
The server must be launchable as a local executable, for example:

```bash
web-search-mcp
```

---

## 8. Capabilities to Expose

Expose **tools** in v1.

### Required tools
1. `search_web`
2. `extract_url`
3. `open_result`
4. `fetch_search_and_extract`
5. `health_check`

### Optional tools
6. `get_result_text_only`
7. `debug_page_diagnostics`

---

## 9. Tool Specifications

### 9.1 `search_web`

#### Purpose
Search the web and return normalized search results without treating the search results page as an article.

#### Input schema
```ts
{
  query: string;
  num_results?: number;        // default 5, max 10
  safe_search?: "off" | "moderate" | "strict";
  locale?: string;             // e.g. "en-US"
  region?: string;             // e.g. "us"
  freshness?: "any" | "day" | "week" | "month";
}
```

#### Output schema
```ts
{
  query: string;
  results: Array<{
    rank: number;
    title: string;
    url: string;
    display_url?: string;
    snippet?: string;
    source?: string;
  }>;
}
```

#### Behavior
- Use a search-provider abstraction.
- Parse only the result cards.
- Extract:
  - title
  - destination URL
  - snippet
  - source/domain if present
- Ignore ads, nav, footer, and unrelated SERP chrome.
- Do **not** run Readability on the SERP.

---

### 9.2 `extract_url`

#### Purpose
Load a destination page and extract its readable main content.

#### Input schema
```ts
{
  url: string;
  max_chars?: number;          // default 12000
  output_format?: "text" | "markdown-lite" | "html";
  wait_until?: "load" | "domcontentloaded" | "network-idle-like";
  timeout_ms?: number;         // default 15000
  settle_time_ms?: number;     // default 1200
  favor_precision?: boolean;   // default true
}
```

#### Output schema
```ts
{
  url: string;
  final_url?: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  site_name?: string;
  lang?: string;
  text?: string;
  content_html?: string;
  content_length: number;
  extraction_score: number;
  warnings?: string[];
}
```

#### Behavior
- create hidden hardened BrowserWindow
- use isolated session partition
- optionally block nonessential resources
- load URL
- wait for load and settle
- remove obvious noise nodes
- run Readability on a cloned DOM
- score the extracted result
- normalize and truncate output

---

### 9.3 `open_result`

#### Purpose
Convenience tool to search and then extract a selected ranked result.

#### Input schema
```ts
{
  query: string;
  rank?: number;               // default 1
  max_chars?: number;
}
```

#### Output schema
```ts
{
  query: string;
  selected_result: {
    rank: number;
    title: string;
    url: string;
    snippet?: string;
  };
  extraction: {
    title?: string;
    excerpt?: string;
    text?: string;
    content_length: number;
    extraction_score: number;
  };
}
```

#### Behavior
- execute internal search
- choose requested rank
- run extraction pipeline on that URL

---

### 9.4 `fetch_search_and_extract`

#### Purpose
Single-call workflow for search + extraction.

#### Input schema
```ts
{
  query: string;
  num_results?: number;            // default 5
  extract_top_n?: number;          // default 3, max 5
  max_chars_per_result?: number;   // default 6000
}
```

#### Output schema
```ts
{
  query: string;
  search_results: Array<{
    rank: number;
    title: string;
    url: string;
    snippet?: string;
  }>;
  extracted_results: Array<{
    rank: number;
    url: string;
    title?: string;
    excerpt?: string;
    text?: string;
    content_length: number;
    extraction_score: number;
    warnings?: string[];
  }>;
}
```

#### Behavior
- Execute internal search via the SERP slot
- Extract top `extract_top_n` results **in parallel**, bounded by the extraction pool semaphore (capacity `BROWSER_CONCURRENCY`)
- Preserve SERP rank ordering in the output regardless of extraction completion order
- Each extraction has its own timeout (`DEFAULT_TIMEOUT_MS`); queue-wait time does NOT count toward the per-item timeout
- **Partial success**: If some extractions fail, return successful results plus per-item error entries in `extracted_results` with `warnings: ['EXTRACTION_FAILED: <reason>']` and `extraction_score: 0`
- The tool itself only fails if the SERP search fails; individual extraction failures are non-fatal

---

### 9.5 `health_check`

#### Purpose
Operational and readiness check.

#### Output schema
```ts
{
  ok: true;
  version: string;
  transport: "stdio";
  electron_available: boolean;
  readiness: {
    search_provider: boolean;
    browser_extractor: boolean;
  };
}
```

---

## 10. Search Provider Design
Define a provider abstraction such as:

```ts
export interface SearchProvider {
  name: string;
  search(input: SearchInput): Promise<SearchResult[]>;
  isAvailable(): Promise<boolean>;
}
```
### Requirements
- normalize all providers to the same output shape
- keep implementation replaceable
- keep SERP parsing separate from article extraction
- avoid site-specific assumptions leaking into core tool handlers
### Default provider: Google SERP scraping

The default search provider loads Google's search results page in a hidden Electron BrowserWindow and parses result cards from the rendered DOM. This approach has zero external API dependencies and zero cost.

#### Why scraping over API
- No API keys required for initial setup
- No external service dependency
- Best result quality (full Google results)
- Electron is already available in the stack
- The same BrowserWindow infrastructure used for extraction can serve SERP loading

#### SERP parsing strategy
- Use **structural DOM patterns**, not class names (Google obfuscates classes and changes them frequently)
- Primary selectors: `<a>` tags containing `<h3>` elements identify result titles
- Extract `href` from the anchor and unwrap Google's `/url?q=` redirect wrapper
- Extract snippet text from the adjacent sibling or parent container of the title link
- Extract display URL from the cite or breadcrumb element near each result
- Skip ads (identified by ad labels or sponsored containers), knowledge panels, "People also ask", and other SERP chrome

#### Raw SERP result shape
```ts
interface RawSerpResult {
  title: string;
  url: string;           // cleaned, unwrapped from Google redirect
  displayUrl?: string;   // the green URL shown in SERP
  snippet?: string;
  isAd: boolean;         // filtered out before returning
  position: number;      // DOM position, mapped to rank
}
```

#### Anti-detection measures
- Set a realistic desktop `User-Agent` via `webContents.setUserAgent()`
- Set `Accept-Language` header matching the configured locale
- Use a realistic viewport size (e.g. 1920×1080)
- Create a **new BrowserWindow with a fresh non-persistent session partition** for each search request. The window is destroyed after the SERP is parsed. This provides true session isolation without complex `clearStorageData` calls.
- Do not rapid-fire requests; enforce a minimum delay between consecutive searches (e.g. 2–5 seconds)

#### Block and error detection
Detect CAPTCHA or block signals:
- Page contains CAPTCHA elements or reCAPTCHA scripts
- HTTP 429 or other rate-limit responses
- Zero result cards parsed from a non-empty page
- Known block-page URL patterns (e.g. `/sorry/`)

When detected, return a structured `SERP_PARSE_FAILED` error with descriptive warnings so the caller knows scraping was blocked, not that no results exist.

#### Fallback behavior
- If the primary scraping attempt returns zero results, retry once with a fresh session partition
- If retry also fails, return the structured error
- The swappable provider interface means users can configure an API-based provider (Brave, Google CSE, Serper, SearXNG, etc.) when scraping becomes unreliable

### Alternative providers (future / user-configured)
The `SearchProvider` interface supports swapping in any of these without changing tool handlers:
- **Brave Search API** — 2k free queries/month, structured JSON
- **Google Custom Search API** — 100 free queries/day, requires CSE setup
- **Serper.dev** — 2.5k free queries, Google results via API
- **SearXNG** — self-hosted, free, private
- **Bing Web Search API** — Azure-based, 1k free/month

---

## 11. Browser Extraction Design

### Why Electron BrowserWindow
Use Electron because it provides:
- real Chromium rendering,
- `webContents` lifecycle hooks,
- `executeJavaScript` in the rendered page,
- session isolation support.

### BrowserWindow requirements
Every extraction window must be:
- `show: false`
- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- isolated from the main app/browser session

### Session model
Each extraction should use:
- a temporary non-persistent partition, or
- a worker pool of isolated ephemeral partitions

Do not reuse the application’s normal session for remote page extraction.

### Extraction lifecycle
1. create hidden BrowserWindow
2. attach isolated session
3. optionally enable resource-block policy
4. load URL
5. wait for `did-finish-load`
6. wait an additional settle delay
7. execute DOM cleanup + Readability
8. collect and normalize results
9. destroy the BrowserWindow in `finally`

### Security Defaults

Every BrowserWindow (extraction and SERP) must enforce these security policies:

#### Protocol Allowlist
- Only allow navigation to `http:` and `https:` URLs
- Block `file:`, `data:`, `blob:`, `javascript:`, `chrome:`, `chrome-extension:`, `devtools:` protocols
- Enforce via `webContents.on('will-navigate')` and `app.on('web-contents-created')` handlers

#### SSRF / Private Network Protection
- Block requests to RFC 1918 private addresses (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`), loopback (`127.x.x.x`, `::1`), and link-local (`169.254.x.x`)
- Block requests to `localhost` regardless of resolution
- Enforce via `session.webRequest.onBeforeRequest` — inspect the resolved IP when possible, reject matching requests

#### Permission Denial
- Deny ALL permission requests (geolocation, notifications, camera, microphone, etc.)
- Enforce via `session.setPermissionRequestHandler(() => false)`
- Also set `session.setPermissionCheckHandler(() => false)`

#### Window/Popup Blocking
- Deny all `window.open()` calls — return `{ action: 'deny' }` from `webContents.setWindowOpenHandler()`
- Prevent all new window creation from page-initiated navigation

#### Download Blocking
- Cancel all downloads immediately via `session.on('will-download', (e, item) => item.cancel())`

#### Certificate Error Handling
- Reject all certificate errors (`app.on('certificate-error', (e, ...) => { e.preventDefault(); callback(false); })`) — do NOT silently accept invalid certificates

#### Error Sanitization
- Never include page-originated content in error messages returned to MCP clients
- Never include full stack traces — map to typed `ExtractionErrorCode` values only

---

## 11a. Extraction Execution Model

### Process Boundaries

The extraction pipeline spans two execution contexts:

| Context | Stages | Why |
|---------|--------|-----|
| **BrowserWindow renderer** (isolated world) | Stages 1, 2, 3 | Needs live DOM, computed styles, `document` access |
| **Node.js main process** | Stages 4, 5 | Operates on Readability's HTML string output; no DOM needed |

### Injection Mechanism

All renderer-side code (Stages 1–3) runs as a single `executeJavaScript` call using an IIFE string injection:

```typescript
// In main process (pipeline.ts)
const readabilitySource = fs.readFileSync(
  path.join(__dirname, '../vendor/Readability.js'), 'utf8'
);

// Build the IIFE that runs Stages 1-3 in the renderer
const extractionScript = `
(function() {
  // --- Stage 1: Metadata ---
  const metadata = extractMetadata(document); // JSON-LD, OG, meta

  // --- Stage 2: Pre-cleanup ---
  runDomCleanup(document); // in-place mutation

  // --- Stage 3: Readability ---
  ${readabilitySource}
  const docClone = document.cloneNode(true);
  const article = new Readability(docClone).parse();

  return { metadata, article };
})()`;

const result = await webContents.executeJavaScript(extractionScript);
// result is serialized via Structured Clone Algorithm
// Safe: metadata + article are plain objects with string/number properties
```

### Security: Isolated World Execution (Preferred)

By default, `executeJavaScript` runs in the **Main World** — the same JS context as the website’s own scripts. This means a malicious page could override `document.cloneNode`, `Array.prototype`, or `Object.keys` to interfere with extraction.

**Preferred approach**: Use `webFrame.executeJavaScriptInIsolatedWorld()` with a dedicated world ID (e.g., `999`) to run extraction code in a separate JS context that shares the same DOM but has its own JS globals:

```typescript
// Via preload script (minimal surface)
const { ipcRenderer, webFrame } = require('electron');

ipcRenderer.on('run-extraction', async (event, script) => {
  const result = await webFrame.executeJavaScriptInIsolatedWorld(999, [
    { code: script }
  ]);
  ipcRenderer.send('extraction-result', result);
});
```

If the isolated world approach proves too complex for v1, `executeJavaScript` in the main world is acceptable with the caveat documented. The isolated world approach should be adopted if any extraction reliability issues are observed.

### Data Flow

```
Main Process                    BrowserWindow Renderer
─────────────────────────────────────────────────────────────────
 1. Create BrowserWindow
 2. Load URL
 3. Wait for did-finish-load + settle
 4. Send extraction script ────→  5. Execute Stages 1-3 in renderer
                                       - Extract metadata (Stage 1)
                                       - Mutate DOM cleanup (Stage 2)
                                       - Clone DOM + run Readability (Stage 3)
 6. Receive result ────────────────  - Return { metadata, article }
 7. Run Stage 4 (post-cleanup on article.content HTML string)
 8. Run Stage 5 (normalize to output format)
 9. Compute quality score
10. Destroy BrowserWindow in finally
```

### Return Type from Renderer

```typescript
interface RendererExtractionResult {
  metadata: PreExtractionMetadata;  // from Stage 1
  article: {                        // from Stage 3 (Readability)
    title: string;
    byline: string | null;
    excerpt: string | null;
    siteName: string | null;
    content: string;              // cleaned HTML
    textContent: string;          // plain text
    length: number;
    lang: string | null;
  } | null;                         // null when Readability fails
  warnings: string[];               // accumulated warnings from Stages 1-3
}
```

All fields are strings, numbers, or null — fully compatible with Structured Clone serialization. Do NOT return DOM nodes, functions, or Symbols.

### Bundling Readability

Pre-bundle `@mozilla/readability` into a standalone IIFE file at build time:

```bash
# Using esbuild (in build script)
esbuild node_modules/@mozilla/readability/Readability.js \
  --bundle --format=iife --global-name=Readability \
  --outfile=vendor/Readability.js
```

The bundled file is read once at server startup and held in memory. It is NOT fetched from a CDN at runtime.

---

## 12. Extraction Pipeline Overview

Extraction is a **5-stage pipeline**. Each stage has a single responsibility and a clear contract.

```
URL → [Stage 1: Metadata] → [Stage 2: Pre-Cleanup] → [Stage 3: Readability] → [Stage 4: Post-Cleanup] → [Stage 5: Normalize] → Output
```

**Stages 1–3** run in the BrowserWindow renderer on the live `document` (in-place mutation). **Stages 4–5** run in the Node.js main process on the HTML string returned by Readability. See Section 11a for the full execution model.

### Pipeline Abort Conditions
- If Stage 2 removes ALL body content → skip to Stage 5, return empty result with `extraction_score: 0`
- If Stage 3 (Readability) returns `null` → fall through to Stage 4's fallback extraction
- If final text length < 50 chars → mark `extraction_score: 0`, add warning `EXTRACTION_EMPTY`

---

## 12a. Stage 1 — Pre-Extraction Metadata

Extract structured metadata BEFORE any DOM mutation. This data supplements Readability output.

### JSON-LD Extraction
```typescript
// Find all <script type="application/ld+json"> tags
// Parse each as JSON, collect into array
// Extract from @type "Article", "NewsArticle", "BlogPosting", "WebPage":
//   - headline → title candidate
//   - author.name → byline candidate
//   - datePublished → publishedDate
//   - description → excerpt candidate
//   - publisher.name → siteName candidate
// Silently skip malformed JSON-LD (common on real pages)
```

### Open Graph + Meta Tags
```typescript
interface PreExtractionMetadata {
  title: string | null;        // og:title → <title> → JSON-LD headline
  description: string | null;  // og:description → meta[name=description] → JSON-LD description
  author: string | null;       // meta[name=author] → JSON-LD author.name
  siteName: string | null;     // og:site_name → JSON-LD publisher.name
  publishedDate: string | null;// article:published_time → JSON-LD datePublished
  imageUrl: string | null;     // og:image
  canonicalUrl: string | null; // link[rel=canonical]
  language: string | null;     // html[lang] → meta[http-equiv=content-language]
}
```

### Priority Rules
Readability output takes precedence when non-empty. Metadata fills gaps only:
- `title`: Readability > og:title > JSON-LD headline > `<title>` tag
- `byline`: Readability > meta[name=author] > JSON-LD author.name
- `excerpt`: Readability > og:description > meta[name=description]
- `siteName`: Readability > og:site_name > JSON-LD publisher.name

---

## 12b. Stage 2 — Pre-Readability DOM Cleanup

Remove noise BEFORE Readability runs. This is the most critical stage for extraction quality.

### Cleanup Architecture: Three Tiers

**Tier 1: Exact Selector Removal (high confidence, remove unconditionally)**

These selectors target elements that are NEVER main content:

```typescript
const EXACT_REMOVE_SELECTORS: string[] = [
  // --- Scripts, styles, meta ---
  'script', 'style', 'noscript', 'link[rel=stylesheet]',
  'link[rel=preload]', 'link[rel=prefetch]', 'meta',

  // --- Media / embeds (non-content) ---
  'iframe:not([src*="youtube"]):not([src*="vimeo"]):not([src*="youtu.be"])',
  'canvas', 'object', 'embed', 'applet',

  // --- Ads and tracking ---
  '[id^="google_ads"]', '[id^="ad-"]', '[id^="ad_"]',
  '[class*="adsbygoogle"]', 'ins.adsbygoogle',
  '[data-ad]', '[data-ad-slot]', '[data-ad-client]',
  '[id^="taboola"]', '[id^="outbrain"]', '[class*="taboola"]', '[class*="outbrain"]',
  '.ad-container', '.ad-wrapper', '.ad-unit', '.ad-slot', '.ad-banner',

  // --- Cookie / consent / GDPR ---
  '[id*="cookie-consent"]', '[id*="cookie-banner"]', '[id*="cookie-notice"]',
  '[class*="cookie-consent"]', '[class*="cookie-banner"]', '[class*="cookie-notice"]',
  '[id*="gdpr"]', '[class*="gdpr"]',
  '[id*="consent-banner"]', '[class*="consent-banner"]',
  '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',
  '#CybotCookiebotDialog', '.cc-banner', '.cc-window',

  // --- Social / share ---
  '[class*="share-bar"]', '[class*="sharing"]', '[class*="social-share"]',
  '[class*="share-buttons"]', '[id*="share"]',
  '.social-links', '.social-icons', '.social-media',

  // --- Navigation ---
  'nav', '[role="navigation"]',
  '.breadcrumb', '.breadcrumbs', '[class*="breadcrumb"]',
  '.pagination', '[class*="pagination"]',
  '.menu', '.nav-menu', '.main-menu', '.site-menu',
  '.hamburger', '.mobile-menu', '.nav-toggle',

  // --- Header / Footer ---
  'body > header', 'body > footer',
  'header:not(article header):not(main header)',
  'footer:not(article footer):not(main footer)',
  '#site-header', '#site-footer', '#masthead',
  '.site-header', '.site-footer', '.global-header', '.global-footer',
  '[role="banner"]', '[role="contentinfo"]',

  // --- Sidebar ---
  // NOTE: bare `aside` is intentionally excluded from Tier 1.
  // Some sites use <aside> for article-adjacent content. Instead, remove
  // aside only when it has sidebar/complementary characteristics.
  'aside[role="complementary"]',
  'aside[class*="sidebar"]', 'aside[class*="widget"]', 'aside[class*="related"]',
  '[role="complementary"]',
  '.sidebar', '#sidebar', '.widget-area', '.widget',

  // --- Popups / modals / overlays ---
  '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
  '[class*="lightbox"]', '.backdrop', '.dialog',
  '[role="dialog"]', '[role="alertdialog"]',

  // --- Newsletter / signup ---
  '[class*="newsletter"]', '[class*="subscribe"]', '[class*="signup"]',
  '[id*="newsletter"]', '[id*="subscribe"]',
  '.email-capture', '.lead-form', '.optin',

  // --- Related / recommended ---
  '[class*="related-posts"]', '[class*="recommended"]',
  '[class*="you-may-like"]', '[class*="more-stories"]',
  '[class*="read-next"]', '[class*="also-like"]',
  '.related-articles', '.suggested-content',

  // --- Comments ---
  '#comments', '.comments', '.comment-section',
  '[id*="disqus"]', '.disqus-comment-count',
  '#respond', '.comment-form',

  // --- Misc noise ---
  '.print-only', '.screen-reader-text:not(label)',
  '[aria-hidden="true"]:not(svg):not(path)',
  '[hidden]', '[style*="display:none"]', '[style*="display: none"]',
  '.visually-hidden:not(label)', '.sr-only:not(label)',
  '.skip-link', '.back-to-top',
  'form:not([role="search"])',
  '.toc', '.table-of-contents',
];
```

**Tier 2: Partial Pattern Matching (class/id substring, moderate confidence)**

If an element's `className` or `id` contains any of these substrings (case-insensitive), remove it — UNLESS it matches a Tier 3 preserve rule.

```typescript
const PARTIAL_REMOVE_PATTERNS: string[] = [
  // Ads
  'advert', 'adslot', 'adunit', 'ad-wrap', 'ad_wrap', 'sponsore',
  'promoted', 'dfp-ad', 'gpt-ad',
  // Navigation
  'nav-bar', 'navbar', 'topbar', 'top-bar', 'subnav', 'site-nav',
  'mega-menu', 'dropdown-menu', 'flyout',
  // Footer/Header
  'footer-', '-footer', 'header-', '-header',
  'masthead', 'colophon', 'bottombar',
  // Sidebar
  'sidebar', 'side-bar', 'rail', 'right-col', 'left-col',
  // Social/Share
  'share-', '-share', 'social-', '-social', 'tweet-', 'facebook-',
  'whatsapp', 'telegram', 'linkedin-share',
  // Comments
  'comment-', '-comment', 'disqus', 'discourse-',
  // Newsletter/Promo
  'newsletter', 'subscribe', 'signup', 'sign-up', 'optin', 'opt-in',
  'promo-', '-promo', 'promotion', 'callout', 'cta-',
  // Cookie/Consent
  'cookie', 'consent', 'gdpr', 'privacy-bar', 'notice-bar',
  // Related content
  'related', 'recommended', 'suggested', 'trending',
  'popular-', 'most-read', 'top-stories', 'more-from',
  // Generic noise
  'popup', 'modal', 'overlay', 'lightbox', 'interstitial',
  'toast', 'snackbar', 'notification-bar', 'alert-bar',
  'banner', 'ribbon', 'badge-', 'label-promo',
  'print-', 'hidden-', 'invisible',
  // Tracking/analytics
  'tracking', 'analytics', 'pixel', 'beacon',
];
```

The actual implementation should use the full set from `defuddle/src/constants.ts` (~350 patterns). The above list is the **representative subset** for spec clarity. The implementation file `selectorConfig.ts` will contain the exhaustive list.

**Tier 3: Preserve Rules (override removal)**

Elements matching these rules are NEVER removed, even if they match Tier 1 or Tier 2:

```typescript
const PRESERVE_RULES = [
  // Content containers
  'article', '[role="article"]', 'main', '[role="main"]', '#content', '.content',
  '.post-content', '.article-content', '.entry-content', '.post-body',
  '.article-body', '.story-body',
  // Media that IS content
  'img', 'picture', 'figure', 'figcaption', 'video', 'audio', 'source',
  'iframe[src*="youtube"]', 'iframe[src*="vimeo"]', 'iframe[src*="youtu.be"]',
  // Tables that are content (not layout)
  'table:not([role="presentation"])', 'thead', 'tbody', 'tr', 'td', 'th',
  // Code blocks
  'pre', 'code', '.highlight', '.codehilite', '.code-block',
  // Blockquotes
  'blockquote', '.pullquote', '.quote',
  // Math
  '.math', '.MathJax', '.katex', 'math',
];
```

### Cleanup Execution Order
1. **Preserve-mark**: Query all PRESERVE_RULES elements, set `data-preserve="true"`. Also walk UP from each preserved element and mark all ancestors with `data-has-preserve="true"`.
2. **Exact removal**: Query all EXACT_REMOVE_SELECTORS. Remove if the element is NOT marked `data-preserve` AND NOT marked `data-has-preserve` (i.e., does not contain any preserved descendant).
3. **Partial removal**: Walk all elements, check className+id against PARTIAL_REMOVE_PATTERNS. Remove under the same conditions as step 2.
4. **Hidden element removal**: Remove elements with computed `display:none` or `visibility:hidden`, unless marked `data-preserve` or `data-has-preserve`.
5. **Lazy-load resolution**: For `img[data-src]`, `img[data-lazy-src]`, `img[loading=lazy]` — copy `data-src` → `src` if `src` is missing or is a placeholder.
6. **SVG handling**: Remove standalone SVGs (icons, decorations). Preserve SVGs inside `figure` or with `role="img"`.
7. **Empty container removal**: After all removals, prune `div`, `section`, `span` elements that are now empty (no text, no child elements).
8. **Clean marks**: Remove all `data-preserve` and `data-has-preserve` attributes.

**Key invariant:** A node is never removed if it contains a preserved descendant. This replaces a "reparent/hoist" approach with a simpler "skip removal" approach — no DOM tree restructuring is needed.

### Selector Management
All selectors live in `src/extraction/selectorConfig.ts` for easy maintenance. The file exports:
```typescript
export const EXACT_REMOVE_SELECTORS: string[];
export const PARTIAL_REMOVE_PATTERNS: string[];
export const PRESERVE_RULES: string[];
export const BOILERPLATE_PHRASES: RegExp[];  // used in Stage 4
```

---

## 13. Stage 3 — Readability Extraction

### Pre-check: isProbablyReaderable
Before running Readability, check if the document is likely to produce useful output:
```typescript
import { isProbablyReaderable, Readability } from '@mozilla/readability';

const isReaderable = isProbablyReaderable(document, {
  minContentLength: 140,  // default
  minScore: 20,           // default
});
```
If `!isReaderable`, still attempt extraction but add warning `READABILITY_UNCERTAIN`.

### Readability Configuration
```typescript
const reader = new Readability(clonedDocument, {
  charThreshold: 500,       // min chars for content to be considered
  nbTopCandidates: 5,       // candidates to consider
  keepClasses: false,        // strip classes from output HTML
});
const article = reader.parse();
```

### Readability Output Contract
```typescript
interface ReadabilityResult {
  title: string;        // extracted or ''
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  content: string;      // cleaned HTML
  textContent: string;  // plain text
  length: number;       // textContent char count
  lang: string | null;
}
```

### Null Handling
If `reader.parse()` returns `null`:
1. Add warning `READABILITY_FAILED`
2. Fall through to Stage 4 fallback extraction (see Section 15)
3. Do NOT throw — null is expected for some page types (SPAs, heavy-JS, login walls)

---

## 14. Stage 4 — Post-Readability Cleanup

Readability output still contains noise. This stage scrubs the HTML from `article.content`.

### 14a. Empty Node Removal
Remove elements from the Readability HTML that:
- Contain only whitespace
- Contain only `&nbsp;`
- Are empty self-closing tags (except `img`, `br`, `hr`)

### 14b. Boilerplate Phrase Detection
Scan text nodes and remove paragraphs that are predominantly boilerplate:

```typescript
const BOILERPLATE_PHRASES: RegExp[] = [
  /all rights reserved/i,
  /©\s*\d{4}/,
  /copyright\s*\d{4}/i,
  /terms (of|and) (service|use|conditions)/i,
  /privacy policy/i,
  /cookie policy/i,
  /sign up for our newsletter/i,
  /subscribe to our/i,
  /follow us on/i,
  /share this (article|post|story)/i,
  /related (articles?|posts?|stories)/i,
  /you (may|might) also (like|enjoy|be interested)/i,
  /read more:?$/i,
  /continue reading/i,
  /click here to/i,
  /advertisement/i,
  /sponsored content/i,
  /this (article|post) (was|is) (originally )?(published|posted)/i,
  /\d+ min read/i,
  /photo\s*(credit|by|courtesy|:)/i,
  /getty images/i,
  /shutterstock/i,
  /associated press/i,
  /^tags?:\s/i,
  /^filed under:?\s/i,
  /^posted in:?\s/i,
  /^categorized:?\s/i,
];
```

A paragraph is boilerplate if:
- Its text matches 2+ boilerplate phrases, OR
- Its text matches 1 boilerplate phrase AND its char length < 100, OR
- It consists of ≥80% links (link text / total text ratio)

### 14c. Link-Dense Block Removal
After Readability, recheck link density on remaining block elements (`p`, `div`, `li`, `td`):
- If link text length / total text length > 0.6 AND total text < 200 chars → remove
- This catches "Related:", "Tags:", and navigation fragments that survived Readability

### 14d. Surviving Noise Patterns
Final regex pass on text to remove:
- Inline tracking: `utm_source=...`, `?ref=...` from visible link text
- Email obfuscation artifacts: `[at]`, `[dot]`
- Excessive whitespace: normalize to single space between words, max 2 blank lines between blocks

---

## 14e. Stage 5 — Output Normalization
### `text` mode
```
1. Start from article.textContent (plain text from Readability)
2. Apply Stage 4 boilerplate removal on text level
3. Normalize Unicode: NFKC normalization
4. Collapse whitespace: multiple spaces → single space per line
5. Normalize line breaks: \r\n → \n, max 2 consecutive blank lines
6. Trim leading/trailing whitespace per line
7. Truncate to configured limit (default 100_000 chars)
8. Ensure valid UTF-8 (no orphaned surrogates)
```
### `markdown-lite` mode
**Design constraint:** This is a "lite" converter, not a full HTML-to-Markdown engine. It handles Readability's relatively clean output (post-Stage 4), NOT arbitrary HTML. Nesting beyond 2 levels is flattened.

```
1. Start from article.content (HTML from Readability, post Stage 4 cleanup)
2. Walk the DOM tree (parse HTML string using a lightweight parser like linkedom)
3. Convert elements using a single recursive tree-walk:

   Supported elements (flat or one level of nesting):
   - <h1>-<h6> → # through ###### prefixed lines (with blank line before/after)
   - <p> → text block with blank line separator
   - <a href="url">text</a> → [text](url)
   - <strong>/<b> → **text**
   - <em>/<i> → *text*
   - <code> → `text`  (inline)
   - <pre><code> → fenced code block (``` with optional lang from class)
   - <ul>/<li> → - list items (nested <ul> gets 2-space indent, max 2 levels)
   - <ol>/<li> → 1. list items (nested <ol> gets 3-space indent, max 2 levels)
   - <blockquote> → > prefixed lines
   - <img alt="x" src="y"> → ![x](y)
   - <table> → simplified pipe table (header row + separator + body rows)
   - <hr> → ---
   - <br> → newline

   Nesting rules:
   - Inline formatting inside links: [**bold text**](url) ✓
   - Links inside list items: - see [link](url) for details ✓
   - Bold/italic inside headings: # **Important** heading ✓
   - Deeper nesting (e.g., table inside blockquote): flatten to text

   Unknown/unsupported tags: extract textContent, discard tag

4. Escape markdown special chars in literal text: \*, \[, \], \`, \#  (only at line start for #)
5. Strip all remaining HTML tags (safety net)
6. Apply same whitespace normalization as text mode
7. Truncate to configured limit
```
### `html` mode
```
1. Return article.content (HTML from Readability) after Stage 4 cleanup
2. Ensure all tags are properly closed
3. Remove all class/id/style attributes (already done by Readability with keepClasses:false)
4. Remove all data-* attributes
5. Preserve: src, href, alt, title, colspan, rowspan, headers (accessibility)
6. Truncate to configured limit
```

---

## 15. Quality Scoring and Fallbacks

### Extraction Score Formula
Compute a score 0–100:

```typescript
function computeExtractionScore(params: {
  textLength: number;
  sentenceCount: number;      // periods + question marks + exclamation marks
  linkCharRatio: number;      // link text chars / total chars
  boilerplateHits: number;    // count of boilerplate phrases found in final output
  hasTitle: boolean;
  hasByline: boolean;
  hasExcerpt: boolean;
  hasPublishedDate: boolean;
  readabilitySucceeded: boolean;
}): number {
  let score = 0;

  // Length scoring (0-40 points)
  if (params.textLength >= 5000) score += 40;
  else if (params.textLength >= 2000) score += 30;
  else if (params.textLength >= 1000) score += 20;
  else if (params.textLength >= 300) score += 10;
  else if (params.textLength >= 50) score += 5;
  // Sentence density (0-25 points)
  const avgSentenceLen = params.textLength / Math.max(params.sentenceCount, 1);
  if (avgSentenceLen >= 40 && avgSentenceLen <= 200) score += 25;
  else if (avgSentenceLen >= 20 && avgSentenceLen <= 300) score += 12;
  // Link density penalty (0 to -20)
  if (params.linkCharRatio > 0.5) score -= 20;
  else if (params.linkCharRatio > 0.3) score -= 10;
  else if (params.linkCharRatio > 0.15) score -= 5;
  score -= Math.min(params.boilerplateHits * 3, 15);
  // Metadata bonuses (0-20 points)
  if (params.hasTitle) score += 7;
  if (params.hasByline) score += 4;
  if (params.hasExcerpt) score += 4;
  if (params.hasPublishedDate) score += 5;

  // Readability success bonus (0-15 points)
  if (params.readabilitySucceeded) score += 15;

  return Math.max(0, Math.min(100, score));
}
```

### Score Interpretation
| Range | Label | Meaning |
|-------|-------|---------|
| 80-100 | excellent | Clean article content |
| 60-79 | good | Usable content, minor noise possible |
| 40-59 | fair | Partial content, some noise |
| 20-39 | poor | Significant noise or missing content |
| 0-19 | failed | Extraction essentially failed |

### Weak Extraction Conditions
Extraction is marked `weak` (adds warning `EXTRACTION_WEAK`) if:
- `extraction_score < 40`
- OR text length < 300 chars AND score < 60
- OR link density > 0.5

### Fallback Extraction (when Readability returns null)
1. Query `main, article, [role="main"], .post-content, .article-content, .entry-content`
2. If found, extract `textContent` from the best container (longest text)
3. If not found, extract `body > *` excluding elements removed in Stage 2
4. Apply Stage 4 post-cleanup on the fallback text
5. Add warning `USED_FALLBACK_EXTRACTION`
6. Score will naturally be low due to `readabilitySucceeded: false`

---

## 16. Resource Blocking Policy

Support optional blocking of nonessential resource types:
- images
- media
- fonts
- known tracker/ad requests

Do **not** block scripts by default, because many pages require JavaScript to render their content.

This should be an internal policy layer rather than a required user-facing knob in v1.

---

## 17. Error Handling

Implement typed internal errors.

```ts
export type ExtractionErrorCode =
  | "INVALID_URL"
  | "LOAD_TIMEOUT"
  | "NAVIGATION_FAILED"
  | "READABILITY_EMPTY"
  | "SERP_PARSE_FAILED"
  | "SERP_BLOCKED"              // CAPTCHA, rate limit, or block page detected
  | "SERP_NO_RESULTS"           // query returned zero organic results
  | "STDIO_DISCONNECTED"
  | "INTERNAL_ERROR";
```

### Error-handling requirements
- never leak raw stack traces to MCP clients
- always return structured tool-friendly error messages
- catch BrowserWindow crashes
- catch request-hook/session errors
- catch `EPIPE` / stdio disconnects
- enforce timeouts
- always destroy BrowserWindow in `finally`

---

## 18. Concurrency Model
### Extraction pool
Limit extraction concurrency to a small fixed pool, such as **2–4 BrowserWindows**.
### Dedicated SERP slot
SERP loading uses a **separate slot** from the extraction pool, serialized via a mutex (one search at a time to respect rate-limiting). Each search request creates a **new BrowserWindow with a fresh non-persistent session partition**, which is destroyed after parsing. This avoids the contradiction of "reusing" a window while needing session isolation.

**Rationale:** Search is a prerequisite for extraction. If `fetch_search_and_extract` uses the same pool for both SERP loading and page extraction, it can deadlock when all extraction slots are occupied and a search needs to run first. A dedicated SERP slot avoids this.
### Queue/semaphore
Implement a simple semaphore (counting semaphore with capacity `BROWSER_CONCURRENCY`) around extraction tasks. The SERP slot has its own lightweight mutex to serialize search requests.
### Window lifecycle
- **Extraction pool:** create/destroy per request (clean slate, no state leaks)
- **SERP window:** create/destroy per search request with a fresh session partition (clean slate, true isolation)

---

## 19. Configuration

Support environment variables and optionally a config file.

### Required environment variables
```bash
SEARCH_PROVIDER=google-scraping   # default; alternatives: brave, google-cse, serper, searxng
SEARCH_LOCALE=en-US
SEARCH_REGION=us
DEFAULT_NUM_RESULTS=5
MAX_NUM_RESULTS=10
DEFAULT_TIMEOUT_MS=15000
DEFAULT_SETTLE_MS=1200
MAX_CHARS_DEFAULT=12000
BROWSER_CONCURRENCY=2
LOG_LEVEL=info
```

### Optional environment variables
```bash
RESOURCE_BLOCK_IMAGES=true
RESOURCE_BLOCK_MEDIA=true
RESOURCE_BLOCK_FONTS=true
HEADLESS_MODE=true
SEARCH_MIN_DELAY_MS=2000         # minimum delay between consecutive SERP requests
SEARCH_MAX_DELAY_MS=5000         # maximum delay (random jitter within range)
```

---

## 20. Logging and Observability

All logs must go to **stderr**.

### Required log fields
- `request_id`
- `tool_name`
- `query` or `url`
- `elapsed_ms`
- `extraction_score`
- `result_count`
- `warning_count`
- `error_code`

No non-protocol content may ever be written to stdout.

---

## 21. Recommended Project Structure

```text
src/
  index.ts
  server/
    mcpServer.ts
    transport.ts
    tools/
      searchWeb.ts
      extractUrl.ts
      openResult.ts
      fetchSearchAndExtract.ts
      healthCheck.ts
  search/
    SearchProvider.ts
    providers/
      googleScrapingProvider.ts    # default: SERP scraping via Electron
    parsers/
      googleSerpParser.ts          # extracts result cards from Google SERP DOM
      serpParserTypes.ts           # shared types for SERP parsers
    models.ts
  browser/
    browserPool.ts                 # extraction pool (2-4 windows)
    serpWindow.ts                  # dedicated SERP BrowserWindow with mutex
    windowFactory.ts
    sessionFactory.ts
    resourcePolicy.ts
  extraction/                       # 5-stage extraction pipeline
    pipeline.ts                    # orchestrates stages 1-5 in sequence
    metadataExtractor.ts           # Stage 1: JSON-LD, OG, meta tag extraction
    domCleanup.ts                  # Stage 2: pre-Readability DOM cleanup (3-tier)
    selectorConfig.ts              # Stage 2: all selector lists (exact, partial, preserve)
    readabilityRunner.ts           # Stage 3: Readability execution + null handling
    postCleanup.ts                 # Stage 4: empty nodes, boilerplate, link density
    boilerplatePatterns.ts         # Stage 4: BOILERPLATE_PHRASES regex array
    qualityScore.ts                # computeExtractionScore() + score interpretation
  normalize/
    text.ts                        # Stage 5: text mode normalization
    markdownLite.ts                # Stage 5: markdown-lite conversion
    html.ts                        # Stage 5: HTML attribute stripping + cleanup
  util/
    errors.ts
    logger.ts
    validation.ts
    timeouts.ts
    url.ts
    userAgent.ts                   # realistic UA generation
    securityPolicy.ts              # protocol allowlist, SSRF, permissions
tests/
  unit/
    extraction/                    # mirror src/extraction/ structure
      metadataExtractor.test.ts
      domCleanup.test.ts
      selectorConfig.test.ts       # verify selectors are valid CSS
      postCleanup.test.ts
      qualityScore.test.ts
    normalize/
      text.test.ts
      markdownLite.test.ts
      html.test.ts
  integration/
  fixtures/
    articles/                      # real-world HTML snapshots for extraction tests
    serp/                          # Google SERP HTML fixtures
vendor/
  Readability.js                   # pre-bundled IIFE (generated at build time)
README.md
Agent.md
```

---

## 22. Implementation Requirements for Codex

### MCP server
- Use `McpServer` class (high-level API) from `@modelcontextprotocol/sdk/server/mcp.js`
- Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Register tools via `server.registerTool()` with Zod input schemas
- Return success: `{ content: [{ type: 'text', text: '...' }] }`
- Return tool-level errors: `{ isError: true, content: [{ type: 'text', text: '...' }] }`
- All logging via `console.error` (never `console.log` — it corrupts the stdio JSON-RPC stream)
- Keep implementation modular

```typescript
// Example server setup pattern
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'web-search-mcp', version: '1.0.0' });

server.registerTool('search_web', {
  description: 'Search the web and return normalized results',
  inputSchema: z.object({
    query: z.string(),
    num_results: z.number().min(1).max(10).default(5),
  }),
}, async ({ query, num_results }) => {
  // ... implementation
  return { content: [{ type: 'text', text: JSON.stringify(results) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```
### Electron integration
- Electron code must run only in the main process
- do not expose privileged APIs to remote pages
- if preload is used, expose only the smallest safe surface
- see Section 11 Security Defaults for required hardening
### Readability integration
- Pre-bundle Readability into a standalone IIFE at build time (see Section 11a)
- do not fetch extractor scripts from external CDNs at runtime
- inject via `executeJavaScript` (or isolated world) after render
### Session isolation
- use a dedicated non-persistent session partition per extraction and per SERP request
- never reuse the application's default session

### Graceful Shutdown
- Handle `SIGINT` and `SIGTERM` signals
- On shutdown: destroy all active BrowserWindows, close the MCP transport, exit cleanly
- Ensure no orphaned Electron processes survive after the main process exits
- Handle `EPIPE` on stdout gracefully (client disconnected) — trigger shutdown, do not crash

---

## 23. Testing Requirements
### Unit tests — Core
Cover:
- input validation
- tool schema handling
- error mapping
### Unit tests — Extraction Pipeline
Cover each stage independently using fixture HTML strings:

**Stage 1 (metadataExtractor):**
- extracts JSON-LD headline, author, datePublished from valid ld+json
- handles malformed JSON-LD gracefully (no throw)
- extracts og:title, og:description, og:image
- priority chain: Readability > OG > JSON-LD > raw tags
- handles pages with zero metadata (all fields null)

**Stage 2 (domCleanup + selectorConfig):**
- Tier 1: all EXACT_REMOVE_SELECTORS are valid CSS (parse test)
- Tier 1: `<nav>`, cookie banners, ad divs are removed; bare `<aside>` is NOT in Tier 1 (moved to targeted selectors)
- Tier 1: YouTube/Vimeo iframes are NOT removed
- Tier 2: elements with class containing 'sidebar', 'newsletter', etc. are removed
- Tier 2: elements matching partial pattern BUT also matching preserve rule are kept
- Tier 3: `<article>`, `<main>`, `<figure>`, `<pre>`, `<code>` are never removed
- Preserve-mark ordering: nodes containing preserved descendants are never removed (`data-has-preserve` ancestor marking)
- Hidden elements: `[style*="display:none"]` removed, `[aria-hidden="true"]` on non-SVG removed
- Lazy-load: `img[data-src]` gets `src` attribute populated
- Empty container pruning: div/section with no text or children after cleanup are removed

**Stage 3 (readabilityRunner):**
- article page returns title, byline, textContent, content HTML
- null result triggers READABILITY_FAILED warning (no throw)
- isProbablyReaderable returns false triggers READABILITY_UNCERTAIN warning
- charThreshold and nbTopCandidates configs are respected

**Stage 4 (postCleanup):**
- empty nodes (whitespace-only `<p>`, `<div>`) are removed
- paragraphs matching 2+ boilerplate phrases are removed
- single boilerplate phrase + <100 chars paragraph is removed
- link-dense blocks (>0.6 ratio, <200 chars) are removed
- content paragraphs with links are NOT removed (ratio < 0.6)
- utm_source parameters are stripped from visible text

**Stage 5 (normalize):**
- text mode: whitespace collapse, max 2 blank lines, NFKC normalization
- markdown-lite mode: headings, links, bold, italic, code blocks, lists, blockquotes, images, tables
- html mode: class/id/style/data-* attributes stripped, src/href/alt preserved
- all modes: truncation at configured limit

**Quality scoring:**
- 5000+ char clean article scores 80+
- <50 char extraction scores 0-5
- high link density (>0.5) reduces score by 20
- metadata bonuses: +7 title, +4 byline, +4 excerpt, +5 date
- weak extraction threshold: score < 40 triggers EXTRACTION_WEAK
### Integration tests
Cover:
- stdio server starts and responds
- `health_check` succeeds
- `search_web` returns normalized results
- `extract_url` returns readable content for a sample page
- full pipeline: noisy fixture HTML → clean text with no nav/footer/ads/cookies
- timeouts return structured errors
- BrowserWindow is destroyed after completion
- logs go to stderr only
### Extraction quality integration tests
Use saved HTML fixture files in `tests/fixtures/articles/`:
- **News article** (e.g., NYT/BBC style): extracts article body, strips nav/header/footer/related/comments/newsletter
- **Blog post** (e.g., Medium style): extracts post content, strips claps/responses/sidebar recommendations
- **Documentation page** (e.g., MDN style): extracts doc content, preserves code blocks and tables, strips breadcrumbs/sidebar-nav
- **Recipe page**: extracts recipe content, strips ads interleaved in instructions
- **Minimal page** (<200 chars content): returns low score, EXTRACTION_WEAK warning
- **SPA shell** (empty body + JS): Readability returns null, fallback extraction attempted
- **Login wall page**: returns minimal content, low score
### SERP scraping tests
Cover:
- Google SERP parser extracts title, URL, snippet from fixture HTML
- Google redirect URLs (`/url?q=...`) are correctly unwrapped
- Ads and sponsored results are filtered out
- CAPTCHA/block page detection returns `SERP_BLOCKED` error
- Empty result set returns `SERP_NO_RESULTS` error
- Retry logic fires on initial zero-result parse
- Fresh session partition is created per search request
- Rate-limiting delay is enforced between consecutive searches
### Security tests
Verify:
- `contextIsolation === true`
- `nodeIntegration === false`
- `sandbox === true`
- no preload bridge leaks privileged APIs
- session isolation across requests
- protocol allowlist blocks `file:`, `data:`, `javascript:` URLs
- SSRF protection blocks requests to RFC 1918 / loopback addresses
- permission requests are denied
- `window.open()` is blocked
- downloads are cancelled
- certificate errors are rejected

---

## 24. Acceptance Criteria

The implementation is complete when:

1. an MCP client can launch the server over stdio,
2. `health_check` succeeds,
3. `search_web` returns title, URL, snippet, and rank,
4. `extract_url` returns cleaned readable text for typical article pages,
5. boilerplate such as headers, footers, nav, sidebars, and cookie banners is materially reduced,
6. stdout is reserved strictly for MCP protocol traffic,
7. broken stdio pipes do not crash the process with unhandled exceptions,
8. BrowserWindows are always cleaned up,
9. search providers can be swapped without rewriting tool handlers,
10. tests cover happy path and failure path behavior.

---

## 25. Nice-to-Have v2 Items

- support more search providers
- PDF/document extraction
- screenshot capture
- chunking output for RAG ingestion
- SERP scraping support for additional search engines (Bing, DuckDuckGo)
- Adaptive rate limiting based on block frequency
- document resources in MCP in addition to tools
- Streamable HTTP transport
- canonical URL deduplication
- fallback extractors beyond Readability

---

## 26. Suggested Prompt for Codex

```text
Design and implement a production-minded MCP server in TypeScript that runs over stdio and exposes web-search and page-extraction tools.

Requirements:
- Use the official MCP TypeScript SDK and stdio transport
- Use Electron BrowserWindow to load destination pages in a hidden hardened renderer
- Use isolated Electron sessions/partitions
- Keep sandbox=true, contextIsolation=true, nodeIntegration=false
- Use Mozilla Readability to extract readable content from a cloned rendered DOM
- Add a DOM cleanup pass before Readability to remove scripts, styles, iframes, svg, canvas, nav, header, footer, aside, hidden elements, and likely boilerplate selectors such as ad/cookie/sidebar/related/share/newsletter
- Implement MCP tools:
  1) search_web
  2) extract_url
  3) open_result
  4) fetch_search_and_extract
  5) health_check
- Keep logs on stderr only
- Add structured typed errors
- Add defensive handling for stdio disconnects / EPIPE
- Add unit and integration tests
- Organize code into search/, browser/, normalize/, server/, util/
- Make the search provider replaceable behind an interface
- Return structured JSON-friendly tool outputs suitable for LLM use
- Include README instructions for local build and stdio launch
```

---

## 27. Reference Basis

This spec is based on:
- MCP documentation for SDKs, TypeScript server construction, and stdio transport
- Electron documentation for `webContents`, security, context isolation, and sandboxing
- Mozilla Readability documentation for extracting readable article content from a DOM

