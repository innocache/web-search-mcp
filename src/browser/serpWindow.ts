import type { BrowserWindow } from 'electron';
import type { AppConfig } from '../util/config.js';
import { Mutex } from './browserPool.js';
import { createSerpWindow, destroyWindow } from './windowFactory.js';
import { randomDelay } from '../util/timeouts.js';
import { ExtractionError } from '../util/errors.js';

const serpMutex = new Mutex();
let lastSearchTime = 0;

export async function withSerpWindow<T>(
  config: AppConfig,
  locale: string,
  fn: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  await serpMutex.acquire();
  let win: BrowserWindow | null = null;
  try {
    const elapsed = Date.now() - lastSearchTime;
    if (elapsed < config.searchMinDelayMs && lastSearchTime > 0) {
      await randomDelay(
        config.searchMinDelayMs - elapsed,
        config.searchMaxDelayMs - elapsed,
      );
    }

    win = createSerpWindow(config, locale);
    const result = await fn(win);
    lastSearchTime = Date.now();
    return result;
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError('SERP_PARSE_FAILED', 'SERP window operation failed', err);
  } finally {
    await destroyWindow(win);
    serpMutex.release();
  }
}
