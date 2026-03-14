import { app } from 'electron';
import { createMcpServer } from './server/mcpServer.js';
import { loadConfig } from './util/config.js';
import { setLogLevel, logStartup, logFatal } from './util/logger.js';
import { GoogleScrapingProvider } from './search/providers/googleScrapingProvider.js';
import { BrowserWindow } from 'electron';

const config = loadConfig();
setLogLevel(config.logLevel);

function destroyAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      // already destroyed
    }
  }
}

function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    logStartup(`Received ${signal}, shutting down`);
    destroyAllWindows();
    app.quit();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      logStartup('EPIPE on stdout — client disconnected, shutting down');
      destroyAllWindows();
      app.quit();
    }
  });
}

app.whenReady().then(async () => {
  try {
    setupGracefulShutdown();

    const searchProvider = new GoogleScrapingProvider(config);
    logStartup(`Search provider: ${searchProvider.name}`);

    await createMcpServer(config, searchProvider);
  } catch (err) {
    logFatal('Failed to start MCP server', {
      error: err instanceof Error ? err.message : String(err),
    });
    app.quit();
    process.exit(1);
  }
});

app.on('window-all-closed', () => {
  // Prevent default quit — MCP server runs headless, windows are transient
});
