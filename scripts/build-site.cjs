// Publish only the application and its source notes, not local tools or tests.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'index.html', 'style.css', 'app.js', 'data-services.js', 'weather.js',
  'solar-system.js', 'media-library.js', 'dsn-now.js', 'HIRISE.md',
  'data/README.md', 'data/insight-weather-response.json'
];
for (const file of files) {
  const target = path.join(root, 'dist', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`Built ${files.length} static files in dist/`);
