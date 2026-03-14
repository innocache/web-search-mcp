import type { BrowserWindow, Session } from 'electron';
import { checkSsrf } from './url.js';

const configuredSessions = new WeakSet<Session>();

export function applySecurityDefaults(win: BrowserWindow): void {
  const wc = win.webContents;
  const ses = wc.session;

  wc.setWindowOpenHandler(() => ({ action: 'deny' as const }));

  // Chromium's default cert validation rejects invalid certificates.
  // We do NOT add an explicit certificate-error handler here because
  // callback(false) would override --ignore-certificate-errors and
  // silently block CDN subrequests that modern SPAs depend on.

  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  ses.setPermissionCheckHandler(() => false);

  ses.on('will-download', (_event, item) => {
    item.cancel();
  });
}

export function applyRequestFiltering(win: BrowserWindow): void {
  const ses = win.webContents.session;

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        callback({ cancel: true });
        return;
      }

      checkSsrf(url.hostname);

      callback({});
    } catch {
      callback({ cancel: true });
    }
  });
}
