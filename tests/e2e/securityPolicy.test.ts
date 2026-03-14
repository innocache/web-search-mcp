/// <reference types="vitest/globals" />

import { app, BrowserWindow } from 'electron';
import { vi } from 'vitest';
import { applyRequestFiltering, applySecurityDefaults } from '../../src/util/securityPolicy.js';
import { loadConfig } from '../../src/util/config.js';
import type { AppConfig } from '../../src/util/config.js';
import { fixtureUrl } from './helpers.js';

vi.mock('electron', async () => {
  const { createElectronMock } = await import('./helpers.js');
  return createElectronMock();
});

type RequestFilterListener = (
  details: { url: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;

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

describe('securityPolicy', () => {
  const createdWindows: BrowserWindow[] = [];

  beforeAll(async () => {
    await app.whenReady();
    createTestConfig();
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

  it('applySecurityDefaults does not throw on a valid window', () => {
    const win = createWindow();
    expect(() => applySecurityDefaults(win)).not.toThrow();
  });

  it('applyRequestFiltering does not throw on a valid window', () => {
    const win = createWindow();
    expect(() => applyRequestFiltering(win)).not.toThrow();
  });

  it('applySecurityDefaults installs window open denial handler', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents, 'setWindowOpenHandler');

    applySecurityDefaults(win);

    expect(spy).toHaveBeenCalledOnce();
    const handler = spy.mock.calls[0]?.[0];
    expect(
      handler?.({
        url: 'https://example.com',
        frameName: '',
        features: '',
        disposition: 'new-window',
        referrer: { url: '', policy: 'strict-origin-when-cross-origin' },
        postBody: undefined,
      } as Electron.HandlerDetails).action,
    ).toBe('deny');
  });

  it('permission check handler returns false', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session, 'setPermissionCheckHandler');

    applySecurityDefaults(win);

    expect(spy).toHaveBeenCalledOnce();
    const handler = spy.mock.calls[0]?.[0] as (() => boolean) | undefined;
    expect(handler?.()).toBe(false);
  });

  it('applies both security functions in sequence without error', () => {
    const win = createWindow();

    expect(() => {
      applySecurityDefaults(win);
      applyRequestFiltering(win);
    }).not.toThrow();
  });

  it('window can load an HTTP fixture URL after policies are applied', async () => {
    const win = createWindow();
    applySecurityDefaults(win);
    applyRequestFiltering(win);

    await expect(win.loadURL(fixtureUrl('simple-article.html'))).resolves.toBeUndefined();
  });

  it('window can execute JavaScript after policies are applied', async () => {
    const win = createWindow();
    applySecurityDefaults(win);
    applyRequestFiltering(win);

    await win.loadURL(fixtureUrl('simple-article.html'));
    const title = await win.webContents.executeJavaScript('document.title');

    expect(title).toBe('City Transit Board Approves Overnight Service Pilot');
  });

  it('window loads fixture content successfully with security policies', async () => {
    const win = createWindow();
    applySecurityDefaults(win);
    applyRequestFiltering(win);

    await win.loadURL(fixtureUrl('simple-article.html'));
    const h1Text = await win.webContents.executeJavaScript('document.querySelector("h1")?.textContent ?? ""');

    expect(h1Text).toContain('Overnight Service Pilot');
  });

  it('request filtering blocks non-http protocols', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyRequestFiltering(win);

    const listener = spy.mock.calls[0]?.[0] as RequestFilterListener | undefined;
    const outcomes: Array<{ cancel?: boolean }> = [];
    listener?.({ url: 'file:///tmp/test.html' }, (response) => {
      outcomes.push(response);
    });

    expect(outcomes[0]).toEqual({ cancel: true });
  });

  it('request filtering allows public https URLs and blocks localhost SSRF targets', () => {
    const win = createWindow();
    const spy = vi.spyOn(win.webContents.session.webRequest, 'onBeforeRequest');

    applyRequestFiltering(win);

    const listener = spy.mock.calls[0]?.[0] as RequestFilterListener | undefined;
    const allowed: Array<{ cancel?: boolean }> = [];
    const blocked: Array<{ cancel?: boolean }> = [];

    listener?.({ url: 'https://example.com/path' }, (response) => {
      allowed.push(response);
    });
    listener?.({ url: 'https://localhost/path' }, (response) => {
      blocked.push(response);
    });

    expect(allowed[0]).toEqual({});
    expect(blocked[0]).toEqual({ cancel: true });
  });
});
