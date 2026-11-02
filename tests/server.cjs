// Servidor local para pruebas: sirve el repo en /aura-catalogo/ (igual que GitHub Pages).
// Uso: node tests/server.cjs [puerto]
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = '/aura-catalogo/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

function start(port = 0) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/aura-catalogo') { res.writeHead(301, { Location: BASE }); return res.end(); }
    if (!u.pathname.startsWith(BASE)) { res.writeHead(404); return res.end('404'); }
    let rel = decodeURIComponent(u.pathname.slice(BASE.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
module.exports = { start, BASE };
if (require.main === module) start(Number(process.argv[2]) || 8080).then((s) => console.log(`http://127.0.0.1:${s.address().port}${BASE}?mock=1`));
