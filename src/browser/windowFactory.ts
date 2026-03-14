import { BrowserWindow, session } from 'electron';
import { generateUserAgent } from '../util/userAgent.js';
import { applySecurityDefaults, applyRequestFiltering } from '../util/securityPolicy.js';
import type { AppConfig } from '../util/config.js';

const EXTRACTION_PARTITION = 'persist:extraction';
const SERP_PARTITION = 'persist:serp';

export function createExtractionWindow(config: AppConfig): BrowserWindow {
  const ses = session.fromPartition(EXTRACTION_PARTITION, { cache: false });

  const win = new BrowserWindow({
    show: !config.headlessMode,
    width: 1920,
    height: 1080,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
      webSecurity: true,
      allowRunningInsecureContent: false,
      javascript: true,
    },
  });

  applySecurityDefaults(win);
  applyRequestFiltering(win);
  win.webContents.setUserAgent(generateUserAgent());

  return win;
}

export function createSerpWindow(config: AppConfig, locale: string): BrowserWindow {
  const ses = session.fromPartition(SERP_PARTITION, { cache: false });

  const win = new BrowserWindow({
    show: !config.headlessMode,
    width: 1920,
    height: 1080,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
      webSecurity: true,
      allowRunningInsecureContent: false,
      javascript: true,
    },
  });

  applySecurityDefaults(win);
  applyRequestFiltering(win);
  win.webContents.setUserAgent(generateUserAgent());

  const langHeader = locale || 'en-US';
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders, 'Accept-Language': `${langHeader},en;q=0.9` };
    callback({ requestHeaders: headers });
  });

  return win;
}

export async function destroyWindow(win: BrowserWindow | null): Promise<void> {
  if (!win) return;
  try {
    if (!win.isDestroyed()) {
      if (typeof win.once === 'function') {
        const closed = new Promise<void>(resolve => win.once('closed', resolve));
        win.close();
        await closed;
      } else {
        win.destroy();
      }
    }
  } catch {
    // Window already destroyed — safe to ignore
  }
}
