// Standalone, loopback-only preview. No dependencies or build step required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = 8765;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/data-services.js', ['data-services.js', 'text/javascript; charset=utf-8']],
  ['/weather.js', ['weather.js', 'text/javascript; charset=utf-8']],
  ['/media-library.js', ['media-library.js', 'text/javascript; charset=utf-8']],
  ['/dsn-now.js', ['dsn-now.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/solar-system.js', ['solar-system.js', 'text/javascript; charset=utf-8']],
  ['/data/insight-weather-response.json', ['data/insight-weather-response.json', 'application/json']],
  ['/HIRISE.md', ['HIRISE.md', 'text/plain; charset=utf-8']],
  ['/data/README.md', ['data/README.md', 'text/plain; charset=utf-8']]
]);
function createServer() { return http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  let pathname;
  try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; }
  catch {
    res.writeHead(400); res.end(req.method === 'HEAD' ? undefined : 'Bad request'); return;
  }
  if (pathname === '/__mars_health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? '' : 'mars-gis-local-v1'); return;
  }
  const file = files.get(pathname);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, file[0]), (error, data) => {
    if (error) { res.writeHead(404); res.end('File unavailable'); return; }
    res.writeHead(200, {
      'Content-Type': file[1], 'Content-Length': data.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}); }
if (require.main === module) createServer().listen(port, '127.0.0.1');
module.exports = { createServer };
