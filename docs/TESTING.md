# Testing Guide

This document outlines the testing strategy, infrastructure, and quality assurance processes for the `web-search-mcp` project.

## Overview

The project employs a two-layer testing strategy to ensure both deterministic reliability and real-world extraction quality.

1.  **Layer 1: Deterministic Validation** — Fast, mock-based unit tests and fixture-based E2E tests that run in CI to prevent regressions.
2.  **Layer 2: Real-World Validation** — Integration tests using a real Electron environment, quality audits against live URLs, and manual search tests to validate performance against the evolving web.

## Layer 1: Unit + E2E Tests (Deterministic)

Layer 1 tests are powered by **Vitest** and are designed to be fast and reliable.

### Unit Tests
Unit tests focus on individual components such as URL normalization, SERP parsing, and quality score calculation.
- **Framework**: Vitest 4.x
- **Configuration**: `globals:true` (tests use `describe`, `it`, `expect` without imports)
- **Reference**: Each test file includes `/// <reference types="vitest/globals" />`
- **Location**: `tests/unit/`
- **Execution**: `npm test`

### E2E Component Tests
These tests validate the extraction pipeline using hand-crafted HTML fixtures. They mock the Electron environment where possible or run in a headless mode that simulates the browser environment.
- **Location**: `tests/e2e/`
- **Execution**: `npm run test:e2e`

### Integration Tests
Validates the Model Context Protocol (MCP) server integration, ensuring tools like `search_web` and `health_check` are correctly registered and respond to client requests.
- **File**: `tests/integration/mcpServer.test.ts`
- **Execution**: Included in `npm test`

### Running Layer 1
```bash
# Run unit and integration tests
npm test

# Run E2E component tests
npm run test:e2e

# Run all Layer 1 tests
npm run test:all
```

## Layer 2: Real-World Validation

Layer 2 tests validate the system against the real web and the actual Electron binary.

### Electron Tests
Runs the full extraction pipeline inside a real Electron environment. This validates that the project correctly interacts with Electron's `BrowserWindow` and handles real-world web features like JavaScript execution and resource blocking.
- **Runner**: `scripts/run-electron-tests.mts`
- **Execution**: `npm run test:e2e:electron`

### Quality Audit
A comprehensive audit script that visits a diverse set of 12 Tier A URLs to measure extraction performance. It scores results based on text length, link density, and boilerplate detection.
- **Execution**: `npx tsx scripts/run-quality-audit.mts`
- **Metrics**: Extraction score (0-100), noise detection hits, content quality.
- **Tiers**:
    - **Tier A**: Public article pages used for pass rate calculation.
    - **Tier B**: Restricted or paywalled pages used for qualitative analysis.

### Manual Search Test
An ad-hoc testing tool that spawns the MCP server and executes real Google searches. It is used to verify the end-to-end flow from query to extracted content.
- **Execution**: `npx tsx scripts/manual-search-test.mts "your query"`
- **Help**: `npx tsx scripts/manual-search-test.mts --help`

## Test Fixtures

Fixtures are stored in `tests/fixtures/` and provide the deterministic input for Layer 1 tests.

### Fixture Categories
- `articles/`: Sample HTML pages for extraction testing.
- `serp/`: Saved Google Search Result Pages (SERP) for parser testing.
- `e2e/`: Complex multi-resource fixtures for pipeline testing.

### Refreshing Fixtures
The `refresh-fixtures` script fetches trending content from Google Trends to generate new, relevant test cases.
- **Execution**: `npm run refresh-fixtures`
- **Design**: Fixtures are hand-crafted or snapshotted to ensure assertions remain deterministic.

## Quality Audit

The quality audit is the primary mechanism for measuring extraction "intelligence."

### Measurement Criteria
- **Extraction Score**: A 0-100 score calculated by `src/extraction/qualityScore.ts`.
- **Noise Detection**: Identifies remnants of "boilerplate" (cookies, nav, ads) using regex patterns.
- **Content Quality**: Measures paragraph count and average sentence length.

### Tier A URLs
The audit targets 12 high-priority sites:
- **News**: AP News, BBC, Reuters
- **Tech**: GitHub Blog, MDN, Dev.to, Pragmatic Engineer (Substack)
- **Reference**: Wikipedia, Paul Graham
- **Platforms**: Reddit, Medium (via Freedium)
- **General**: NYT (Homepage)

### Performance Thresholds
- **Pass Threshold**: A score of >= 65 is required for article pages to be considered a "Pass."
- **Current Status**: 10/12 Tier A URLs passing (83% pass rate).

## Writing New Tests

### Conventions
- **Reference**: Always include `/// <reference types="vitest/globals" />` at the top of `.test.ts` files.
- **Naming**: Use `.test.ts` suffix.
- **Structure**: Use `describe` blocks to group related tests and `it` for individual assertions.

### Fixture-Based Testing
When adding support for a new site or fixing an extraction bug:
1. Save the raw HTML to `tests/fixtures/articles/`.
2. Create a corresponding test in `tests/e2e/pipeline.test.ts` or a new unit test.
3. Define expectations for "with" (content that must exist) and "without" (noise that must be removed).

## Troubleshooting

### Electron Not Found
If Electron tests fail to spawn, ensure dependencies are installed:
```bash
npm install
```

### Timeouts
Real-world tests (Layer 2) may time out due to network conditions. Use the `--timeout` flag in the manual search test or adjust `defaultTimeoutMs` in the audit config if necessary.

### Certificate Warnings
The quality audit and manual search tests ignore certificate errors by default to ensure broad compatibility with various network environments and proxy configurations.

### Slow Extraction
Extraction speed depends on the complexity of the page and the `settleMs` configuration. If extraction is consistently slow, consider reducing `settleMs` or enabling more aggressive resource blocking (images, fonts, media) in the configuration.

### Memory Usage
Spawning multiple Electron instances can be memory-intensive. The `browserConcurrency` setting in `AppConfig` controls how many windows are opened simultaneously. For low-memory environments, set this to `1`.

## Continuous Integration (CI) Integration
The Layer 1 tests are designed to be executed in a CI environment (e.g., GitHub Actions). The `npm run test:all` command provides a comprehensive check that includes unit, integration, and E2E component tests. Layer 2 tests are typically run manually or in a specialized environment that supports the Electron binary and has internet access.

### CI Configuration Example
A typical CI workflow should include:
1.  **Environment Setup**: Install Node.js and dependencies.
2.  **Build**: Run `npm run build` to ensure the project compiles.
3.  **Test**: Run `npm test` and `npm run test:e2e`.
4.  **Lint**: Run `npm run lint` to check for type errors.

## Future Testing Goals
- **Visual Regression**: Implementing visual regression tests for the SERP parser to detect layout changes in Google Search.
- **Automated Audit**: Integrating the quality audit into a weekly scheduled CI job to track extraction quality over time.
- **Expanded Fixtures**: Increasing the diversity of the fixture corpus to include more non-English sites and varied content types (e.g., forums, academic papers).
- **Performance Benchmarking**: Adding automated performance benchmarks to track extraction latency and memory usage across different Electron versions.
- **Mock Search Provider**: Expanding the mock search provider to simulate various network failure modes and rate-limiting scenarios.
