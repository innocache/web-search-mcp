# Technical Architecture: web-search-mcp

This document provides a deep-dive into the technical architecture of the `web-search-mcp` project, a Model Context Protocol (MCP) server that provides high-quality web search and content extraction capabilities using Electron's BrowserWindow for headless rendering.

## Overview

The system follows a 4-layer architecture designed for modularity, security, and high-fidelity content extraction.

1.  **Layer A: MCP Server** — Handles the protocol interface, tool registration, and communication with the LLM client.
2.  **Layer B: Search Provider** — Abstracted interface for web search, with a default implementation for scraping Google SERPs.
3.  **Layer C: Browser Extraction** — Manages the lifecycle of Electron BrowserWindow instances, enforcing security policies and resource constraints.
4.  **Layer D: Content Normalization** — Processes raw extracted content into clean, LLM-friendly formats (Text, Markdown, HTML).

## System Diagram

```text
+-------------------------------------------------------+
|                     MCP Client                        |
+--------------------------+----------------------------+
                           |
                           v (stdio)
+-------------------------------------------------------+
|                Layer A: MCP Server                    |
|  (Tool Registration, Input Validation, Error Mapping) |
+------------+-----------------------------+------------+
             |                             |
             v                             v
+--------------------------+   +------------------------+
| Layer B: Search Provider |   |   Extraction Pipeline  |
| (Google Scraping Impl)   |   | (Stages 1-5 Execution) |
+------------+-------------+   +-----------+------------+
             |                             |
             v                             v
+--------------------------+   +------------------------+
| Layer C: Browser (SERP)  |   | Layer C: Browser (Ext) |
| (Mutex-locked, Delay)    |   | (Semaphore-controlled) |
+------------+-------------+   +-----------+------------+
             |                             |
             +--------------+--------------+
                            |
                            v
               +-------------------------+
               |   Electron WebContents  |
               | (Security & Resource HW)|
               +-------------------------+
```

## Layer A: MCP Server

The MCP Server layer is built on the `@modelcontextprotocol/sdk`. It serves as the entry point for all requests.

*   **Tool Registration**: Registers tools like `searchWeb`, `extractUrl`, `openResult`, and `fetchSearchAndExtract`.
*   **Transport**: Uses `StdioServerTransport` for communication.
*   **Input Validation**: Uses Zod schemas (via the SDK) to ensure all tool inputs (URLs, queries, limits) are well-formed.
*   **Error Mapping**: Catches internal `ExtractionError` instances and maps them to sanitized client messages, preventing internal stack traces from leaking to the LLM.

```typescript
// Example tool registration in src/server/mcpServer.ts
registerSearchWebTool(server, config, searchProvider);
registerExtractUrlTool(server, config);
registerOpenResultTool(server, config, searchProvider);
```

## Layer B: Search Provider

The search functionality is abstracted behind the `SearchProvider` interface, allowing for swappable backends.

*   **GoogleScrapingProvider**: The default implementation. It navigates to Google Search and parses the SERP (Search Engine Results Page).
*   **SERP Parsing**: Uses a specialized renderer script to extract organic results while filtering out ads, "People Also Ask" sections, and other noise.
*   **Anti-Detection**:
    *   **User-Agent Rotation**: Generates realistic browser User-Agents.
    *   **Random Delays**: Enforces a configurable delay between searches (via `SEARCH_MIN_DELAY_MS` and `SEARCH_MAX_DELAY_MS`).
    *   **Block Detection**: Detects CAPTCHAs, "unusual traffic" warnings, and reCAPTCHA frames, throwing a `SERP_BLOCKED` error.

```javascript
// Anti-detection logic in src/search/providers/googleScrapingProvider.ts
const detectSerpBlock = () => {
  if (document.location.href.toLowerCase().includes('/sorry/')) {
    return 'Google returned a /sorry/ anti-bot page';
  }
  if (document.querySelector('iframe[src*="recaptcha" i]')) {
    return 'Google reCAPTCHA challenge detected';
  }
  return null;
};
```

## Layer C: Browser Extraction

This layer manages the Electron `BrowserWindow` instances used for both searching and content extraction.

*   **Lifecycle Management**: The `windowFactory` creates and destroys windows. Windows are transient and destroyed immediately after use to conserve memory.
*   **Session Isolation**: Uses separate Electron sessions with unique partitions (`persist:extraction` and `persist:serp`) to prevent cross-site tracking and ensure clean states.
*   **Security Hardening**:
    *   `sandbox: true`: Enables Chromium's sandbox.
    *   `contextIsolation: true`: Isolates the renderer process from the main process.
    *   `nodeIntegration: false`: Disables Node.js access in the renderer.
    *   `webSecurity: true`: Enforces Same-Origin Policy.
*   **Resource Blocking**: Configurable blocking of images, media, and fonts to speed up page loads and reduce bandwidth usage.

```typescript
// Security defaults in src/util/securityPolicy.ts
export function applySecurityDefaults(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
}
```

## Extraction Pipeline

The extraction pipeline is a 5-stage process that transforms a raw URL into structured, cleaned content.

```text
[ URL ] -> [ Stage 1: Metadata ] -> [ Stage 2: DOM Cleanup ] -> [ Stage 3: Readability ]
                                                                        |
[ Output ] <- [ Stage 5: Normalization ] <- [ Stage 4: Post-Cleanup ] <-+
```

### Stage 1: Metadata Extraction
Executed in the renderer process. It extracts structured data from:
*   `application/ld+json` (JSON-LD)
*   OpenGraph (`og:*`) and Twitter (`twitter:*`) meta tags
*   Standard meta tags (author, description, keywords)
*   Canonical URL and language attributes

### Stage 2: Pre-Readability DOM Cleanup
Executed in the renderer process before Readability.js runs. It uses a 3-tier approach:
1.  **Exact Selectors**: Removes known noise elements (scripts, styles, ads, nav, footer, sidebars).
2.  **Partial Patterns**: Removes elements with classes or IDs matching noise patterns (e.g., `*comment*`, `*popup*`, `*social*`).
3.  **Preserve Rules**: Protects essential content containers (e.g., `article`, `main`, `.post-content`) from being accidentally removed.

### Stage 3: Readability Execution
Injects a bundled version of Mozilla's `Readability.js` into the renderer process. It parses the cleaned DOM to identify the primary article content, title, and byline.

### Stage 4: Post-Readability Cleanup
Executed in the Node.js main process using `linkedom` for fast DOM manipulation.
*   **Boilerplate Removal**: Strips common phrases like "All rights reserved" or "Privacy Policy".
*   **Link Density Filtering**: Removes blocks with high link-to-text ratios (likely navigation or related links).
*   **Empty Node Removal**: Recursively prunes empty elements.
*   **Tracking Parameter Stripping**: Removes UTM and other tracking parameters from text content.

### Stage 5: Output Normalization
Converts the cleaned HTML into the requested format:
*   **Text**: Plain text with preserved paragraph structure and block-level spacing.
*   **Markdown**: High-fidelity Markdown conversion with support for tables, code fences, and lists.
*   **HTML**: Sanitized HTML with all attributes stripped except for essential ones like `src` and `href`.

## Concurrency Model

The system uses a dual-locking mechanism to manage concurrency and prevent deadlocks.

*   **Extraction Pool (Semaphore)**: A counting semaphore limits the number of simultaneous page extractions (default: 2). This prevents memory exhaustion from too many Electron instances.
*   **SERP Mutex**: A mutual exclusion lock ensures only one search operation happens at a time. This is critical for avoiding rate-limiting and detection by search providers.
*   **Separate Slots**: Because search and extraction use different locking mechanisms, a search operation does not block the extraction pool, and vice versa.

```typescript
// Semaphore implementation in src/browser/browserPool.ts
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly capacity: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active++;
      return;
    }
    return new Promise((resolve) => this.queue.push(() => {
      this.active++;
      resolve();
    }));
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
```

## Security Model

Security is enforced at multiple levels to protect the host system and prevent SSRF.

*   **Protocol Allowlist**: Only `http:` and `https:` protocols are permitted.
*   **SSRF Protection**: All hostnames are validated against a blacklist (e.g., `localhost`, `127.0.0.1`, private IP ranges) before any request is made.
*   **Permission Denial**: All renderer permission requests (camera, microphone, geolocation, etc.) are automatically denied.
*   **Popup/Download Blocking**: Window creation via `window.open` is denied, and all downloads are automatically cancelled.
*   **Certificate Handling**: Uses standard Chromium certificate validation; invalid or self-signed certificates are rejected by default.

## Data Flow

1.  **Request**: MCP Client calls `fetchSearchAndExtract` with a query.
2.  **Search**:
    *   `GoogleScrapingProvider` acquires the SERP Mutex.
    *   Navigates to Google Search in a dedicated `BrowserWindow`.
    *   Parses results and releases the Mutex.
3.  **Extraction**:
    *   For each result, the pipeline acquires an Extraction Semaphore slot.
    *   A new `BrowserWindow` is created with strict security policies.
    *   The page is loaded and "settled" (waiting for network idle or DOM stability).
    *   The renderer script executes Stages 1-3.
4.  **Processing**:
    *   Main process receives the renderer results.
    *   Executes Stage 4 (Post-Cleanup) and Stage 5 (Normalization).
    *   The window is destroyed and the Semaphore slot is released.
5.  **Response**: The aggregated results are returned to the MCP Client.

## Configuration

The system is configured via environment variables, loaded in `src/util/config.ts`.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SEARCH_PROVIDER` | `google-scraping` | The search backend to use. |
| `SEARCH_LOCALE` | `en-US` | Language for search results. |
| `SEARCH_REGION` | `us` | Region for search results. |
| `BROWSER_CONCURRENCY` | `2` | Max simultaneous page extractions. |
| `HEADLESS_MODE` | `true` | Whether to run Electron in headless mode. |
| `DEFAULT_TIMEOUT_MS` | `15000` | Global timeout for network operations. |
| `RESOURCE_BLOCK_IMAGES`| `true` | Block image loading in browser. |
| `LOG_LEVEL` | `info` | Logging verbosity (debug, info, warn, error). |

## Error Handling

The system uses a typed `ExtractionError` class to handle failures gracefully.

*   **Typed Error Codes**: Includes `INVALID_URL`, `LOAD_TIMEOUT`, `NAVIGATION_FAILED`, `SERP_BLOCKED`, etc.
*   **Sanitization**: Error messages are sanitized before being sent to the client to avoid exposing internal paths or sensitive data.
*   **Graceful Shutdown**: The main process listens for `SIGINT` and `SIGTERM` to destroy all active windows and quit the Electron app cleanly.

```typescript
// Error handling in src/util/errors.ts
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.code = code;
  }
  toClientMessage(): string {
    return `[${this.code}] ${this.message}`;
  }
}
```
