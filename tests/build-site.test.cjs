const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('production build includes every local script, stylesheet and terrain asset', () => {
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, ['scripts/build-site.cjs'], { cwd: root });
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map(match => match[1]).filter(file => !/^(?:[a-z]+:|\/\/)/i.test(file));
  assets.push('data/mola-meg004-topography.img', 'data/mola-meg004-areoid-radius-offset.img',
    'data/terrain-regions/manifest.json', ...require('../terrain-model.js').REGIONS.map(region => region.file));
  for (const file of assets) {
    assert.deepEqual(fs.readFileSync(path.join(root, 'dist', file)),
      fs.readFileSync(path.join(root, file)), `Missing or stale deployed asset: ${file}`);
  }
});
