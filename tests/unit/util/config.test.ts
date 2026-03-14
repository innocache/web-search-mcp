/// <reference types="vitest/globals" />

import { loadConfig } from '../../../src/util/config.js';

const CONFIG_ENV_KEYS = [
  'SEARCH_PROVIDER',
  'SEARCH_LOCALE',
  'SEARCH_REGION',
  'DEFAULT_NUM_RESULTS',
  'MAX_NUM_RESULTS',
  'DEFAULT_TIMEOUT_MS',
  'DEFAULT_SETTLE_MS',
  'MAX_CHARS_DEFAULT',
  'BROWSER_CONCURRENCY',
  'LOG_LEVEL',
  'RESOURCE_BLOCK_IMAGES',
  'RESOURCE_BLOCK_MEDIA',
  'RESOURCE_BLOCK_FONTS',
  'HEADLESS_MODE',
  'SEARCH_MIN_DELAY_MS',
  'SEARCH_MAX_DELAY_MS',
] as const;

describe('loadConfig', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of CONFIG_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  beforeEach(() => {
    for (const key of CONFIG_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of CONFIG_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns defaults when env vars are not set', () => {
    const cfg = loadConfig();

    expect(cfg).toEqual({
      searchProvider: 'google-scraping',
      searchLocale: 'en-US',
      searchRegion: 'us',
      defaultNumResults: 5,
      maxNumResults: 10,
      defaultTimeoutMs: 15000,
      defaultSettleMs: 1200,
      maxCharsDefault: 12000,
      browserConcurrency: 2,
      logLevel: 'info',
      resourceBlockImages: true,
      resourceBlockMedia: true,
      resourceBlockFonts: true,
      headlessMode: true,
      searchMinDelayMs: 2000,
      searchMaxDelayMs: 5000,
    });
  });

  it('respects string and numeric env var overrides', () => {
    process.env.SEARCH_PROVIDER = 'custom-provider';
    process.env.SEARCH_LOCALE = 'fr-FR';
    process.env.SEARCH_REGION = 'fr';
    process.env.DEFAULT_NUM_RESULTS = '12';
    process.env.MAX_NUM_RESULTS = '44';
    process.env.DEFAULT_TIMEOUT_MS = '9000';
    process.env.DEFAULT_SETTLE_MS = '333';
    process.env.MAX_CHARS_DEFAULT = '8800';
    process.env.BROWSER_CONCURRENCY = '9';
    process.env.LOG_LEVEL = 'warn';
    process.env.SEARCH_MIN_DELAY_MS = '111';
    process.env.SEARCH_MAX_DELAY_MS = '777';

    const cfg = loadConfig();

    expect(cfg.searchProvider).toBe('custom-provider');
    expect(cfg.searchLocale).toBe('fr-FR');
    expect(cfg.searchRegion).toBe('fr');
    expect(cfg.defaultNumResults).toBe(12);
    expect(cfg.maxNumResults).toBe(44);
    expect(cfg.defaultTimeoutMs).toBe(9000);
    expect(cfg.defaultSettleMs).toBe(333);
    expect(cfg.maxCharsDefault).toBe(8800);
    expect(cfg.browserConcurrency).toBe(9);
    expect(cfg.logLevel).toBe('warn');
    expect(cfg.searchMinDelayMs).toBe(111);
    expect(cfg.searchMaxDelayMs).toBe(777);
  });

  it('falls back for invalid numeric env values', () => {
    process.env.DEFAULT_NUM_RESULTS = 'abc';
    process.env.MAX_NUM_RESULTS = 'NaN';
    process.env.DEFAULT_TIMEOUT_MS = 'ten';
    process.env.DEFAULT_SETTLE_MS = 'x1';
    process.env.MAX_CHARS_DEFAULT = 'size';
    process.env.BROWSER_CONCURRENCY = 'many';
    process.env.SEARCH_MIN_DELAY_MS = 'min';
    process.env.SEARCH_MAX_DELAY_MS = 'max';

    const cfg = loadConfig();

    expect(cfg.defaultNumResults).toBe(5);
    expect(cfg.maxNumResults).toBe(10);
    expect(cfg.defaultTimeoutMs).toBe(15000);
    expect(cfg.defaultSettleMs).toBe(1200);
    expect(cfg.maxCharsDefault).toBe(12000);
    expect(cfg.browserConcurrency).toBe(2);
    expect(cfg.searchMinDelayMs).toBe(2000);
    expect(cfg.searchMaxDelayMs).toBe(5000);
  });

  it("treats boolean env values 'true' and '1' as true", () => {
    process.env.RESOURCE_BLOCK_IMAGES = 'true';
    process.env.RESOURCE_BLOCK_MEDIA = '1';
    process.env.RESOURCE_BLOCK_FONTS = 'TRUE';
    process.env.HEADLESS_MODE = '1';

    const cfg = loadConfig();

    expect(cfg.resourceBlockImages).toBe(true);
    expect(cfg.resourceBlockMedia).toBe(true);
    expect(cfg.resourceBlockFonts).toBe(true);
    expect(cfg.headlessMode).toBe(true);
  });

  it("treats boolean env values 'false', '0', and others as false", () => {
    process.env.RESOURCE_BLOCK_IMAGES = 'false';
    process.env.RESOURCE_BLOCK_MEDIA = '0';
    process.env.RESOURCE_BLOCK_FONTS = 'maybe';
    process.env.HEADLESS_MODE = 'off';

    const cfg = loadConfig();

    expect(cfg.resourceBlockImages).toBe(false);
    expect(cfg.resourceBlockMedia).toBe(false);
    expect(cfg.resourceBlockFonts).toBe(false);
    expect(cfg.headlessMode).toBe(false);
  });
});
