const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildPreview } = require('../scripts/build-preview.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('generated preview embeds current sources in dependency order and parses', () => {
  const preview = buildPreview();
  const scripts = [...preview.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
  assert.equal(scripts.length, 6);
  ['data-services.js', 'weather.js', 'app.js', 'solar-system.js', 'media-library.js', 'dsn-now.js'].forEach((file, i) => {
    assert.ok(scripts[i].includes(read(file)));
    new vm.Script(scripts[i]);
  });
  assert.ok(preview.includes(read('style.css')));
});
test('all literal UI references resolve and IDs are unique', () => {
  const ids = [...read('index.html').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const file of ['app.js', 'weather.js', 'solar-system.js', 'media-library.js', 'dsn-now.js']) {
    for (const match of read(file).matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), match[1]);
  }
});
test('Opportunity reference and honest feature labels remain consistent', () => {
  const source = read('app.js');
  assert.match(source, /id: 'opportunity'.*lat: -1\.95, lon: -5\.53/);
  for (const file of ['app.js', 'weather.js', 'index.html', 'README.md', 'HIRISE.md']) {
    assert.doesNotMatch(read(file), /-35\.47|Realtime Weather|only weather station|Terrain &amp; Distance Profiler/);
  }
});
test('solar model rejects unsupported dates and keeps physically plausible orbit distances', () => {
  const source = read('solar-system.js');
  const context = { window: {}, document: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('  const canvas=')) + '})();', context);
  const model = context.window.MarsSolarModel;
  for (const date of ['1800-01-01', '2000-01-01', '2026-10-04', '2049-12-31']) {
    const bodies = model.positionsAt(Date.parse(date));
    assert.equal(bodies.length, 8);
    assert.ok(bodies.every(body => body.position.every(Number.isFinite)));
    const earth = model.distanceAU(bodies[2].position), mars = model.distanceAU(bodies[3].position);
    assert.ok(earth > 0.98 && earth < 1.02);
    assert.ok(mars > 1.37 && mars < 1.68);
  }
  for (const date of ['1799-12-31', '2050-01-01']) assert.throws(() => model.positionsAt(Date.parse(date)));
});
