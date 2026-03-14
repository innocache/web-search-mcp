# Contributing to web-search-mcp

Thank you for your interest in contributing to web-search-mcp. This guide provides the necessary information to set up the development environment, understand the project structure, and follow the established code style and contribution workflow.

## Prerequisites

To contribute to this project, ensure you have the following installed:
- **Node.js**: Version 18.0.0 or higher.
- **npm**: The default package manager for Node.js.
- **Electron**: The project uses Electron for web scraping and content extraction.

## Getting Started

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-repo/web-search-mcp.git
    cd web-search-mcp
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Build the project**:
    ```bash
    npm run build
    ```
4.  **Verify the installation**:
    Run the quality audit script to ensure everything is set up correctly:
    ```bash
    npx tsx scripts/run-quality-audit.mts
    ```

## Project Structure

The source code is located in the `src/` directory, organized as follows:
- `browser/`: Electron browser window management and SERP interaction.
- `extraction/`: Content extraction logic, including readability and selector-based cleaning.
- `normalize/`: URL and content normalization utilities.
- `search/`: Search provider implementations and SERP parsers.
- `server/`: MCP server implementation and tool definitions.
- `util/`: Common utilities, configuration, and error handling.
- `index.ts`: Entry point for the MCP server.

Tests are located in the `tests/` directory:
- `unit/`: Unit tests for individual components.
- `integration/`: Tests for component interactions.
- `e2e/`: End-to-end tests for the full search and extraction flow.
- `fixtures/`: HTML and data fixtures used in tests.

## Code Style

This project follows strict TypeScript and ESM conventions:
- **ES Modules**: The project uses `"type": "module"`. All imports must include the `.js` extension (e.g., `import { foo } from './foo.js';`).
- **Strict TypeScript**: The `tsconfig.json` has `strict: true` enabled. Do not use `as any` or `@ts-ignore` to suppress type errors.
- **Naming**: Use camelCase for variables and functions, PascalCase for classes and interfaces.
- **Vitest**: Testing is performed using Vitest with `globals: true`. Test files should include `/// <reference types="vitest/globals" />` at the top.

## Running Tests

The project uses Vitest for unit and integration tests, and a custom runner for Electron-based tests.

- **Unit and Integration Tests**:
  ```bash
  npm test
  ```
- **End-to-End Tests**:
  ```bash
  npm run test:e2e
  ```
- **Electron-specific Tests**:
  ```bash
  npm run test:e2e:electron
  ```
  This runs tests that require a full Electron environment using `scripts/run-electron-tests.mts`.
- **Run All Tests**:
  ```bash
  npm run test:all
  ```
  This executes unit, e2e, and electron tests sequentially.
- **Watch Mode**:
  For a better development experience, you can run tests in watch mode:
  ```bash
  npm run test:watch
  ```

## Quality Audit

Before submitting a contribution that affects the extraction pipeline, run the quality audit to verify extraction quality across 12 diverse real-world URLs:
```bash
npx tsx scripts/run-quality-audit.mts
```
This script spawns Electron, visits each URL, extracts content, and scores the result (0-100). A passing score is >= 65 for article pages. See [docs/QUALITY.md](docs/QUALITY.md) for details.

## Manual Testing

You can manually test the search and extraction functionality using the provided script:
```bash
npx tsx scripts/manual-search-test.mts --help
```
This allows you to run searches against specific providers and inspect the extracted content without starting the full MCP server.

## Building

- **Compile TypeScript**:
  ```bash
  npm run build
  ```
  This runs `tsc` to compile the source code into the `dist/` directory.
- **Bundle Readability**:
  ```bash
  npm run bundle-readability
  ```
  This script bundles the `@mozilla/readability` library for use in the browser environment. It is automatically run as a `prebuild` step.

## Adding a New Search Provider

To add a new search provider:
1.  Implement the `SearchProvider` interface defined in `src/search/SearchProvider.ts`.
2.  Place the implementation in `src/search/providers/`.
3.  If the provider requires a custom SERP parser, add it to `src/search/parsers/`.
4.  Register the new provider in the search manager or server configuration.
5.  Add unit tests for the new provider in `tests/unit/search/`.

## Adding Extraction Selectors

The project uses a list of CSS selectors to remove boilerplate and unwanted content during extraction. To update these:
1.  Edit `src/extraction/selectorConfig.ts`.
2.  Add selectors to `EXACT_REMOVE_SELECTORS` for elements that should always be removed.
3.  Add patterns to `PARTIAL_REMOVE_PATTERNS` for elements that should be removed if they match certain criteria.
4.  Add rules to `PRESERVE_RULES` for elements that should always be kept.
5.  Verify the changes by running `npx tsx scripts/manual-search-test.mts` with a URL that was previously not extracted correctly.

## Commit Guidelines

We prefer conventional commits for descriptive and organized history:
- `feat:` A new feature.
- `fix:` A bug fix.
- `docs:` Documentation changes.
- `style:` Changes that do not affect the meaning of the code (white-space, formatting, etc.).
- `refactor:` A code change that neither fixes a bug nor adds a feature.
- `test:` Adding missing tests or correcting existing tests.
- `chore:` Changes to the build process or auxiliary tools and libraries.

Ensure commit messages are concise and accurately reflect the changes.

## Code Review Checklist

Before opening a pull request, ensure your changes meet the following criteria:
- **TypeScript Strict**: No new type errors; `strict: true` is maintained.
- **No Suppression**: No `as any`, `@ts-ignore`, or `eslint-disable` comments.
- **Tests Pass**: All existing and new tests pass (`npm run test:all`).
- **Diagnostics Clean**: `npm run lint` (type checking) passes without errors.
- **Documentation**: Updated relevant documentation if necessary.
- **Style**: Follows the project's naming and formatting conventions.
