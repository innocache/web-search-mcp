/// <reference types="vitest/globals" />

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';

vi.mock('electron', async () => {
  const { createElectronMock } = await import('./helpers.js');
  return createElectronMock();
});

import { app, BrowserWindow, session } from 'electron';
import { createExtractionWindow, createSerpWindow, destroyWindow } from '../../src/browser/windowFactory.js';
import { loadConfig } from '../../src/util/config.js';
import type { AppConfig } from '../../src/util/config.js';

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

describe('windowFactory', () => {
  const createdWindows: BrowserWindow[] = [];

  beforeAll(async () => {
    await app.whenReady();
  });

  afterEach(async () => {
    while (createdWindows.length > 0) {
      const win = createdWindows.pop() ?? null;
      await destroyWindow(win);
    }
  });

  function trackWindow(win: BrowserWindow): BrowserWindow {
    createdWindows.push(win);
    return win;
  }

  it('createExtractionWindow creates a BrowserWindow instance', () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    expect(win).toBeInstanceOf(BrowserWindow);
  });

  it('createExtractionWindow enforces secure webPreferences', () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    const webContentsWithPrefs = win.webContents as unknown as {
      getLastWebPreferences: () => {
        sandbox: boolean;
        contextIsolation: boolean;
        nodeIntegration: boolean;
      };
    };
    const prefs = webContentsWithPrefs.getLastWebPreferences();

    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  });

  it('createExtractionWindow uses a non-default session partition', () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    expect(win.webContents.session).not.toBe(session.defaultSession);
  });

  it('createExtractionWindow reuses a shared session partition', () => {
    const first = trackWindow(createExtractionWindow(createTestConfig()));
    const second = trackWindow(createExtractionWindow(createTestConfig()));
    expect(first.webContents.session).toBe(second.webContents.session);
  });

  it('createExtractionWindow is not shown when headlessMode is true', () => {
    const win = trackWindow(createExtractionWindow(createTestConfig({ headlessMode: true })));
    expect(win.isVisible()).toBe(false);
  });

  it('createExtractionWindow sets a user agent string', () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    const userAgent = win.webContents.userAgent;

    expect(userAgent.length).toBeGreaterThan(0);
    expect(userAgent).toContain('Mozilla');
  });

  it('createSerpWindow creates a BrowserWindow instance', () => {
    const win = trackWindow(createSerpWindow(createTestConfig(), 'en-US'));
    expect(win).toBeInstanceOf(BrowserWindow);
  });

  it('createSerpWindow sets Accept-Language from locale parameter', async () => {
    let receivedHeader = '';
    const server = createServer((req, res) => {
      receivedHeader = String(req.headers['accept-language'] ?? '');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>ok</title></head><body>ok</body></html>');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    const win = trackWindow(createSerpWindow(createTestConfig(), 'fr-FR'));

    try {
      await win.loadURL(`http://localtest.me:${port}/`);
      expect(receivedHeader).toContain('fr-FR');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('destroyWindow handles null input without throwing', async () => {
    await expect(destroyWindow(null)).resolves.toBeUndefined();
  });

  it('destroyWindow destroys a valid window', async () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    expect(win.isDestroyed()).toBe(false);
    await destroyWindow(win);
    expect(win.isDestroyed()).toBe(true);
    createdWindows.pop();
  });

  it('destroyWindow handles an already-destroyed window without throwing', async () => {
    const win = trackWindow(createExtractionWindow(createTestConfig()));
    await destroyWindow(win);

    await expect(destroyWindow(win)).resolves.toBeUndefined();
    createdWindows.pop();
  });
});
