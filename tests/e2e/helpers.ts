import { EventEmitter } from 'node:events';

export function getFixtureBaseUrl(): string {
  const base = process.env['E2E_FIXTURE_BASE'];
  if (!base) {
    throw new Error('E2E_FIXTURE_BASE not set — globalSetup did not run');
  }
  return base.replace('://127.0.0.1', '://localtest.me');
}

export function fixtureUrl(filename: string): string {
  return `${getFixtureBaseUrl()}/${filename}`;
}

type BeforeRequestHandler = (
  details: { url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;

type BeforeSendHeadersHandler = (
  details: { requestHeaders: Record<string, string> },
  callback: (response: { requestHeaders?: Record<string, string> }) => void,
) => void;

class MockWebRequest {
  private readonly beforeRequestHandlers: BeforeRequestHandler[] = [];
  private readonly beforeSendHeadersHandlers: BeforeSendHeadersHandler[] = [];

  onBeforeRequest(
    filterOrHandler:
      | { urls: string[] }
      | BeforeRequestHandler,
    maybeHandler?: BeforeRequestHandler,
  ): void {
    const handler = typeof filterOrHandler === 'function' ? filterOrHandler : maybeHandler;
    if (handler) {
      this.beforeRequestHandlers.push(handler);
    }
  }

  onBeforeSendHeaders(handler: BeforeSendHeadersHandler): void {
    this.beforeSendHeadersHandlers.push(handler);
  }

  allows(url: string, resourceType: string): boolean {
    for (const handler of this.beforeRequestHandlers) {
      let blocked = false;
      handler({ url, resourceType }, (response) => {
        if (response.cancel) {
          blocked = true;
        }
      });
      if (blocked) {
        return false;
      }
    }
    return true;
  }

  applyHeaders(initialHeaders: Record<string, string>): Record<string, string> {
    let headers = { ...initialHeaders };
    for (const handler of this.beforeSendHeadersHandlers) {
      handler({ requestHeaders: { ...headers } }, (response) => {
        if (response.requestHeaders) {
          headers = { ...response.requestHeaders };
        }
      });
    }
    return headers;
  }
}

class MockSession extends EventEmitter {
  readonly webRequest = new MockWebRequest();
  private permissionRequestHandler: ((webContents: unknown, permission: unknown, callback: (allow: boolean) => void) => void) | null = null;
  private permissionCheckHandler: (() => boolean) | null = null;

  setPermissionRequestHandler(handler: (webContents: unknown, permission: unknown, callback: (allow: boolean) => void) => void): void {
    this.permissionRequestHandler = handler;
  }

  setPermissionCheckHandler(handler: () => boolean): void {
    this.permissionCheckHandler = handler;
  }

  getPermissionRequestHandler(): ((webContents: unknown, permission: unknown, callback: (allow: boolean) => void) => void) | null {
    return this.permissionRequestHandler;
  }

  getPermissionCheckHandler(): (() => boolean) | null {
    return this.permissionCheckHandler;
  }
}

const titlePattern = /<title>([^<]*)<\/title>/i;
const firstH1Pattern = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const tagPattern = /<[^>]+>/g;

function decodeText(input: string): string {
  return input.replace(tagPattern, '').replace(/\s+/g, ' ').trim();
}

class MockWebContents extends EventEmitter {
  readonly session: MockSession;
  private readonly preferences: { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
  private html = '';
  userAgent = 'Mozilla/5.0 (MockElectron)';

  constructor(session: MockSession, preferences: { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean }) {
    super();
    this.session = session;
    this.preferences = preferences;
  }

  setWindowOpenHandler(): { action: 'deny' } {
    return { action: 'deny' };
  }

  setUserAgent(userAgent: string): void {
    this.userAgent = userAgent;
  }

  getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } {
    return this.preferences;
  }

  async loadURL(url: string): Promise<void> {
    if (!this.session.webRequest.allows(url, 'mainFrame')) {
      this.emit('did-fail-load', {}, -1, 'Blocked by request policy', url, true);
      throw new Error(`Blocked by request policy: ${url}`);
    }

    const headers = this.session.webRequest.applyHeaders({});
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    this.html = await response.text();
    this.emit('did-finish-load');
  }

  async executeJavaScript(script: string): Promise<unknown> {
    if (script === 'document.title') {
      const match = this.html.match(titlePattern);
      return match ? decodeText(match[1] ?? '') : '';
    }

    if (script.includes('querySelector("h1")')) {
      const match = this.html.match(firstH1Pattern);
      return match ? decodeText(match[1] ?? '') : '';
    }

    if (script === 'typeof window.require') {
      return 'undefined';
    }

    return null;
  }
}

class MockBrowserWindow {
  private static windows = new Set<MockBrowserWindow>();

  readonly webContents: MockWebContents;
  private destroyed = false;
  private readonly visible: boolean;

  constructor(options: {
    show?: boolean;
    webPreferences?: {
      session?: MockSession;
      sandbox?: boolean;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
    };
  } = {}) {
    const webPreferences = options.webPreferences ?? {};
    const ses = webPreferences.session ?? new MockSession();
    this.webContents = new MockWebContents(ses, {
      sandbox: webPreferences.sandbox ?? true,
      contextIsolation: webPreferences.contextIsolation ?? true,
      nodeIntegration: webPreferences.nodeIntegration ?? false,
    });
    this.visible = Boolean(options.show);
    MockBrowserWindow.windows.add(this);
  }

  isVisible(): boolean {
    return this.visible;
  }

  loadURL(url: string): Promise<void> {
    return this.webContents.loadURL(url);
  }

  destroy(): void {
    this.destroyed = true;
    MockBrowserWindow.windows.delete(this);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  static getAllWindows(): MockBrowserWindow[] {
    return Array.from(MockBrowserWindow.windows);
  }
}

const partitions = new Map<string, MockSession>();
const defaultSession = new MockSession();

export function createElectronMock(): {
  app: { whenReady: () => Promise<void> };
  BrowserWindow: typeof MockBrowserWindow;
  session: {
    defaultSession: MockSession;
    fromPartition: (partition: string, _options?: { cache?: boolean }) => MockSession;
  };
} {
  return {
    app: {
      whenReady: async () => undefined,
    },
    BrowserWindow: MockBrowserWindow,
    session: {
      defaultSession,
      fromPartition: (partition: string) => {
        let ses = partitions.get(partition);
        if (!ses) {
          ses = new MockSession();
          partitions.set(partition, ses);
        }
        return ses;
      },
    },
  };
}
