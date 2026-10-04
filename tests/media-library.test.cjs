const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchUrl, nasaUrl, results, assetUrl } = require('../media-library.js');
test('NASA search encodes queries, types, and pages', () => {
  const url = new URL(searchUrl('Mars & rover', 'video', 2));
  assert.equal(url.origin, 'https://images-api.nasa.gov');
  assert.equal(url.searchParams.get('q'), 'Mars & rover');
  assert.equal(url.searchParams.get('media_type'), 'video');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), '12');
  assert.equal(new URL(searchUrl(' ')).searchParams.get('q'), 'Mars');
});
test('NASA search tolerates missing metadata and ignores unsupported records', () => {
  assert.deepEqual(results({}), []);
  const items = results({ collection: { items: [{}, { data: [{ nasa_id: 'audio', media_type: 'audio' }] },
    { data: [{ nasa_id: 'mars', media_type: 'image', title: 'Mars' }], links: [{ rel: 'preview', href: 'https://images-assets.nasa.gov/image/mars/test.jpg' }] }] } });
  assert.equal(items.length, 1);
  assert.equal(items[0].credit, 'NASA');
  assert.equal(items[0].thumbnail, 'https://images-assets.nasa.gov/image/mars/test.jpg');
});
test('media URLs reject unsafe and lookalike hosts', () => {
  for (const url of ['javascript:alert(1)', 'https://nasa.gov.example.com/a', 'data:text/html,x', undefined]) assert.equal(nasaUrl(url), null);
  assert.equal(nasaUrl('http://images-assets.nasa.gov/a'), 'https://images-assets.nasa.gov/a');
});
test('asset selection uses actual manifests and prefers medium browser formats', () => {
  const payload = { collection: { items: ['orig.tif', 'orig.jpg', 'medium.jpg', 'orig.mov', 'large.mp4', 'medium.mp4', 'metadata.json']
    .map(file => ({ href: 'https://images-assets.nasa.gov/test~' + file })) } };
  assert.equal(assetUrl(payload, 'image'), 'https://images-assets.nasa.gov/test~medium.jpg');
  assert.equal(assetUrl(payload, 'video'), 'https://images-assets.nasa.gov/test~medium.mp4');
  assert.equal(assetUrl({}, 'video'), null);
});
