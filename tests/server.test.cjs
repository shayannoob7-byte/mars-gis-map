const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../local-server.cjs');

test('local server serves all application modules and restricts unrelated paths/methods', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const file of ['/', '/style.css', '/data-services.js', '/weather.js', '/app.js', '/solar-system.js', '/media-library.js', '/dsn-now.js']) {
      const response = await fetch(base + file);
      assert.equal(response.status, 200, file);
      assert.ok((await response.text()).length > 0);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    const head = await fetch(base + '/weather.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/package.json')).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
