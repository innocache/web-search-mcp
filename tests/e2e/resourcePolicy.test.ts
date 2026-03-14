/// <reference types="vitest/globals" />

import { app, BrowserWindow } from 'electron';
import { vi } from 'vitest';
import { applyResourcePolicy } from '../../src/browser/resourcePolicy.js';
import { loadConfig } from '../../src/util/config.js';
import type { AppConfig } from '../../src/util/config.js';
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
    ...overrides,
  };
}

type BeforeRequestListener = (
  details: { url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;

describe('resourcePolicy', () => {
  const createdWindows: BrowserWindow[] = [];

  beforeAll(async () => {
    await app.whenReady();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (createdWindows.length > 0) {
      const win = createdWindows.pop();
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    }
  });

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    createdWindows.push(win);
    return win;
  }

  it('does not throw when all flags are false', () => {
    const win = createWindow();
    const config = createTestConfig({
      resourceBlockImages: false,
      resourceBlockMedia: false,
      resourceBlockFonts: false,
    });

    expect(() => applyResourcePolicy(win, config)).not.toThrow();
  });

  it('registers onBeforeRequest handler when images are blocked', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyResourcePolicy(win, createTestConfig({ resourceBlockMedia: false, resourceBlockFonts: false }));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('registers onBeforeRequest handler when media are blocked', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyResourcePolicy(win, createTestConfig({ resourceBlockImages: false, resourceBlockFonts: false }));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('registers onBeforeRequest handler when fonts are blocked', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyResourcePolicy(win, createTestConfig({ resourceBlockImages: false, resourceBlockMedia: false }));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('registers a handler with all-url filter when all three are blocked', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyResourcePolicy(win, createTestConfig());

    expect(spy).toHaveBeenCalledOnce();
    const firstCall = spy.mock.calls[0] as unknown as [
      { urls: string[] },
      BeforeRequestListener,
    ];
    expect(firstCall?.[0]).toEqual({ urls: ['<all_urls>'] });
  });

  it('always registers onBeforeRequest for SSRF protection even with no resource flags', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');
    applyResourcePolicy(
      win,
      createTestConfig({
        resourceBlockImages: false,
        resourceBlockMedia: false,
        resourceBlockFonts: false,
      }),
    );

    expect(spy).toHaveBeenCalledOnce();
  });

  it('cancels blocked resource types and allows unblocked types', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyResourcePolicy(win, createTestConfig({ resourceBlockMedia: false, resourceBlockFonts: false }));

    const firstCall = spy.mock.calls[0] as unknown as [
      { urls: string[] },
      BeforeRequestListener,
    ];
    const listener = firstCall?.[1];
    expect(listener).toBeTypeOf('function');

    const imageResults: Array<{ cancel?: boolean }> = [];
    listener?.({ url: 'https://example.com/photo.jpg', resourceType: 'image' }, (result) => {
      imageResults.push(result);
    });
    const scriptResults: Array<{ cancel?: boolean }> = [];
    listener?.({ url: 'https://example.com/app.js', resourceType: 'script' }, (result) => {
      scriptResults.push(result);
    });
    expect(imageResults[0]).toEqual({ cancel: true });
    expect(scriptResults[0]).toEqual({});
  });

  it('applies policy and can still load fixture page without throwing', async () => {
    const win = createWindow();
    applyResourcePolicy(win, createTestConfig());

    await expect(win.loadURL(fixtureUrl('simple-article.html'))).resolves.toBeUndefined();
  });
});
