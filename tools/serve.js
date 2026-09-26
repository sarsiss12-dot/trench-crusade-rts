#!/usr/bin/env node
// Zero-dependency static file server for local development and mobile testing on the LAN.
// Usage: node tools/serve.js [port] [--root dir]   (default port 8080, root = project root)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Create (not start) a static server rooted at `root`. */
export function createStaticServer(root) {
  const base = resolve(root);
  const rootSep = base.endsWith(sep) ? base : base + sep;
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(base, p));
      if (file !== base && !file.startsWith(rootSep)) { res.writeHead(403); res.end('forbidden'); return; }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + p); return; }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e));
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const root = resolve(rootIdx >= 0 ? args[rootIdx + 1] : join(here, '..'));
  const port = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--root')) || 8080;
  createStaticServer(root).listen(port, '0.0.0.0', () => {
    console.log(`Trench Crusade RTS dev server: http://localhost:${port}/  (root ${root})`);
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  LAN (phone): http://${a.address}:${port}/`);
    }
  });
}
