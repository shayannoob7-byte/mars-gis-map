const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function buildPreview() {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  return read('index.html')
    .replace(/<link rel="stylesheet" href="([^:"]+)">/g,
      (_, file) => `<style>\n${read(file)}\n</style>`)
    .replace(/<script defer src="([^:"]+)"><\/script>/g,
      (_, file) => `<script>window.addEventListener('DOMContentLoaded', () => {\n${read(file)}\n});</script>`);
}
if (require.main === module) {
  const file = path.join(root, 'preview.html');
  const generated = buildPreview();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== generated) {
      console.error('Preview is missing or stale. Run node scripts/build-preview.cjs.');
      process.exitCode = 1;
    } else console.log('Preview matches application sources.');
  } else { fs.writeFileSync(file, generated); console.log('Built preview.html'); }
}
module.exports = { buildPreview };
