import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
};

const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(moduleDir, '..', 'fixtures', 'e2e');

let server: Server | null = null;

export async function setup(): Promise<void> {
  server = createServer(async (req, res) => {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const safePath = urlPath.replace(/\.\./g, '');
    const filePath = resolve(fixturesDir, safePath.replace(/^\//, ''));

    if (!filePath.startsWith(fixturesDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolvePromise) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (typeof address === 'object' && address !== null) {
        const port = address.port;
        process.env['E2E_FIXTURE_PORT'] = String(port);
        process.env['E2E_FIXTURE_BASE'] = `http://127.0.0.1:${port}`;
        console.log(`[e2e] Fixture server listening on port ${port}`);
      }
      resolvePromise();
    });
  });
}

export async function teardown(): Promise<void> {
  if (server) {
    await new Promise<void>((resolvePromise) => {
      server!.close(() => {
        console.log('[e2e] Fixture server closed');
        resolvePromise();
      });
    });
    server = null;
  }
}
