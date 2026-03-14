/// <reference types="vitest/globals" />

import { app, BrowserWindow } from 'electron';
import { vi } from 'vitest';
import { withSerpWindow } from '../../src/browser/serpWindow.js';
import { loadConfig } from '../../src/util/config.js';
import type { AppConfig } from '../../src/util/config.js';
import { ExtractionError } from '../../src/util/errors.js';
import { fixtureUrl } from './helpers.js';

vi.mock('electron', async () => {
  const { createElectronMock } = await import('./helpers.js');
  return createElectronMock();
});

function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig(),
    headlessMode: true,
    resourceBlockImages: true,
    resourceBlockMedia: true,
    resourceBlockFonts: true,
    searchMinDelayMs: 50,
    searchMaxDelayMs: 100,
    defaultTimeoutMs: 10000,
    defaultSettleMs: 200,
    ...overrides,
  };
}

describe('withSerpWindow', () => {
  const observedWindows: BrowserWindow[] = [];

  beforeAll(async () => {
    await app.whenReady();
  });

  afterEach(() => {
    while (observedWindows.length > 0) {
      const win = observedWindows.pop();
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    }
  });

  it('passes a BrowserWindow to the callback function', async () => {
    await withSerpWindow(createTestConfig(), 'en-US', async (win) => {
      observedWindows.push(win);
      expect(win).toBeInstanceOf(BrowserWindow);
      expect(win.isDestroyed()).toBe(false);
    });
  });

  it('returns the callback return value', async () => {
    const value = await withSerpWindow(createTestConfig(), 'en-US', async () => {
      return { ok: true, source: 'callback' };
    });

    expect(value).toEqual({ ok: true, source: 'callback' });
  });

  it('destroys the window after callback completes', async () => {
    const state: { callbackWindow: BrowserWindow | null } = { callbackWindow: null };

    await withSerpWindow(createTestConfig(), 'en-US', async (win) => {
      state.callbackWindow = win;
      await win.loadURL(fixtureUrl('simple-article.html'));
    });

    expect(state.callbackWindow).not.toBeNull();
    if (state.callbackWindow === null) {
      throw new Error('Expected callback to receive a BrowserWindow');
    }
    expect(state.callbackWindow.isDestroyed()).toBe(true);
  });

  it('wraps non-ExtractionError failures with SERP_PARSE_FAILED', async () => {
    const thrown = withSerpWindow(createTestConfig(), 'en-US', async () => {
      throw new Error('unexpected parse issue');
    });

    await expect(thrown).rejects.toMatchObject({
      name: 'ExtractionError',
      code: 'SERP_PARSE_FAILED',
      message: 'SERP window operation failed',
    });
  });

  it('re-throws ExtractionError as-is', async () => {
    const original = new ExtractionError('SERP_BLOCKED', 'blocked by captcha');

    const thrown = withSerpWindow(createTestConfig(), 'en-US', async () => {
      throw original;
    });

    await expect(thrown).rejects.toBe(original);
  });

  it('serializes two concurrent calls via mutex', async () => {
    const order: string[] = [];
    const state: { releaseFirst: (() => void) | null } = { releaseFirst: null };

    const firstGate = new Promise<void>((resolve) => {
      state.releaseFirst = resolve;
    });

    const first = withSerpWindow(createTestConfig(), 'en-US', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      return 'first';
    });

    const second = withSerpWindow(createTestConfig(), 'en-US', async () => {
      order.push('second-start');
      return 'second';
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(order).toEqual(['first-start']);

    if (state.releaseFirst === null) {
      throw new Error('Expected first gate resolver to be assigned');
    }
    state.releaseFirst();

    const results = await Promise.all([first, second]);
    expect(results).toEqual(['first', 'second']);

    const firstEndIndex = order.indexOf('first-end');
    const secondStartIndex = order.indexOf('second-start');
    expect(firstEndIndex).toBeGreaterThan(-1);
    expect(secondStartIndex).toBeGreaterThan(firstEndIndex);
  });
});
