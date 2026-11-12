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
  ['/science-data.js', ['science-data.js', 'text/javascript; charset=utf-8']],
  ['/terrain-model.js', ['terrain-model.js', 'text/javascript; charset=utf-8']],
  ['/marswalk-planner.js', ['marswalk-planner.js', 'text/javascript; charset=utf-8']],
  ['/marswalk-navigation.js', ['marswalk-navigation.js', 'text/javascript; charset=utf-8']],
  ['/marswalk-terrain.js', ['marswalk-terrain.js', 'text/javascript; charset=utf-8']],
  ['/marswalk.js', ['marswalk.js', 'text/javascript; charset=utf-8']],
  ['/science-explorer.js', ['science-explorer.js', 'text/javascript; charset=utf-8']],
  ['/weather.js', ['weather.js', 'text/javascript; charset=utf-8']],
  ['/media-library.js', ['media-library.js', 'text/javascript; charset=utf-8']],
  ['/dsn-now.js', ['dsn-now.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/solar-system.js', ['solar-system.js', 'text/javascript; charset=utf-8']],
  ['/data/insight-weather-response.json', ['data/insight-weather-response.json', 'application/json']],
  ['/data/mola-meg004-topography.img', ['data/mola-meg004-topography.img', 'application/octet-stream']],
  ['/data/mola-meg004-areoid-radius-offset.img', ['data/mola-meg004-areoid-radius-offset.img', 'application/octet-stream']],
  ['/HIRISE.md', ['HIRISE.md', 'text/plain; charset=utf-8']],
  ['/TERRAIN-DATA.md', ['TERRAIN-DATA.md', 'text/plain; charset=utf-8']],
  ['/MARSWALK.md', ['MARSWALK.md', 'text/plain; charset=utf-8']],
  ['/data/README.md', ['data/README.md', 'text/plain; charset=utf-8']]
]);
for (const region of require('./terrain-model.js').REGIONS) {
  files.set(`/${region.file}`, [region.file, 'application/octet-stream']);
}
files.set('/data/terrain-regions/manifest.json', ['data/terrain-regions/manifest.json', 'application/json; charset=utf-8']);
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
