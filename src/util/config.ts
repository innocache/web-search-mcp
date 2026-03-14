import type { LogLevel } from './logger.js';

export interface AppConfig {
  searchProvider: string;
  searchLocale: string;
  searchRegion: string;
  defaultNumResults: number;
  maxNumResults: number;
  defaultTimeoutMs: number;
  defaultSettleMs: number;
  maxCharsDefault: number;
  browserConcurrency: number;
  logLevel: LogLevel;
  resourceBlockImages: boolean;
  resourceBlockMedia: boolean;
  resourceBlockFonts: boolean;
  headlessMode: boolean;
  searchMinDelayMs: number;
  searchMaxDelayMs: number;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key]?.toLowerCase();
  if (val === undefined) return fallback;
  return val === 'true' || val === '1';
}

function envString(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): AppConfig {
  return {
    searchProvider: envString('SEARCH_PROVIDER', 'google-scraping'),
    searchLocale: envString('SEARCH_LOCALE', 'en-US'),
    searchRegion: envString('SEARCH_REGION', 'us'),
    defaultNumResults: envInt('DEFAULT_NUM_RESULTS', 5),
    maxNumResults: envInt('MAX_NUM_RESULTS', 10),
    defaultTimeoutMs: envInt('DEFAULT_TIMEOUT_MS', 15000),
    defaultSettleMs: envInt('DEFAULT_SETTLE_MS', 1200),
    maxCharsDefault: envInt('MAX_CHARS_DEFAULT', 12000),
    browserConcurrency: envInt('BROWSER_CONCURRENCY', 2),
    logLevel: envString('LOG_LEVEL', 'info') as LogLevel,
    resourceBlockImages: envBool('RESOURCE_BLOCK_IMAGES', true),
    resourceBlockMedia: envBool('RESOURCE_BLOCK_MEDIA', true),
    resourceBlockFonts: envBool('RESOURCE_BLOCK_FONTS', true),
    headlessMode: envBool('HEADLESS_MODE', true),
    searchMinDelayMs: envInt('SEARCH_MIN_DELAY_MS', 2000),
    searchMaxDelayMs: envInt('SEARCH_MAX_DELAY_MS', 5000),
  };
}
