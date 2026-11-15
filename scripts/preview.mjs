import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
await import('./build.mjs');
const html = await readFile(new URL('../ui.html', import.meta.url));
const playerHtml = await readFile(new URL('../player.html', import.meta.url));
const server = createServer((request, response) => {
  if (!['/', '/player.html'].includes(request.url)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-store' });
  response.end(request.url === '/player.html' ? playerHtml : html);
});
server.listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173 (Ctrl+C to stop)'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
