// Publish only the application and its source notes, not local tools or tests.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const terrainRegions = require('../terrain-model.js').REGIONS;
const files = [
  'index.html', 'style.css', 'app.js', 'data-services.js', 'panel-layout.js', 'science-data.js',
  'marswalk-planner.js', 'marswalk-navigation.js', 'marswalk-terrain.js', 'marswalk.js', 'MARSWALK.md',
  'science-explorer.js', 'terrain-model.js', 'weather.js',
  'solar-system.js', 'media-library.js', 'dsn-now.js', 'HIRISE.md',
  'TERRAIN-DATA.md', 'data/README.md', 'data/insight-weather-response.json',
  'data/mola-meg004-topography.img', 'data/mola-meg004-areoid-radius-offset.img'
];
files.push('data/terrain-regions/manifest.json');
files.push(...terrainRegions.map(region => region.file));
for (const file of files) {
  const target = path.join(root, 'dist', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`Built ${files.length} static files in dist/`);
