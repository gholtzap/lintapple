import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const vendorFiles = new Map(['lenis.mjs', 'lenis.css'].map(name => [`/demo/vendor/${name}`, resolve(root, '../node_modules/lenis/dist', name)]));

export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/') { response.writeHead(302, { Location: '/demo/' }); return response.end(); }
      const path = decodeURIComponent((url.pathname === '/demo/' || /^\/demo\/rule\/[^/]+\/?$/.test(url.pathname)) ? '/demo/index.html' : url.pathname);
      const file = vendorFiles.get(path) || resolve(root, `.${path}`);
      if (!vendorFiles.has(path) && !file.startsWith(resolve(root, 'demo') + sep) && file !== resolve(root, 'examples/ui.css')) {
        response.writeHead(404); return response.end('Page not found.');
      }
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404); response.end('Page not found.'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDemoServer();
  server.listen(4173, '127.0.0.1', () => console.log('Demo: http://localhost:4173/demo/'));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
