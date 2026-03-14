import type { BrowserWindow } from 'electron';
import type { AppConfig } from '../util/config.js';
import { checkSsrf } from '../util/url.js';

export function applyResourcePolicy(win: BrowserWindow, config: AppConfig): void {
  const ses = win.webContents.session;

  const blockedTypes = new Set<string>();
  if (config.resourceBlockImages) blockedTypes.add('image');
  if (config.resourceBlockMedia) {
    blockedTypes.add('media');
  }
  if (config.resourceBlockFonts) blockedTypes.add('font');

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const url = new URL(details.url);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        callback({ cancel: true });
        return;
      }

      checkSsrf(url.hostname);

      if (blockedTypes.size > 0 && blockedTypes.has(details.resourceType)) {
        callback({ cancel: true });
        return;
      }

      callback({});
    } catch {
      callback({ cancel: true });
    }
  });
}
