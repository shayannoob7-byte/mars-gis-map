const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../data-services.js');
const archive = require('../data/insight-weather-response.json');
const source = fs.readFileSync(path.join(__dirname, '../weather.js'), 'utf8');
function panel(cached, fetchRems) {
  const nodes = new Map(), handlers = new Map(), storage = new Map();
  if (cached) storage.set('mars-rems-observations-v1', JSON.stringify(cached));
  function element() { return { textContent: '', hidden: true, children: [], focus() {},
    append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } }; }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let disposed = false;
  const context = { window: { MarsData: data, setInterval() { return 1; }, clearInterval() {} },
    document: { createElement: element, activeElement: null },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, Date };
  vm.runInNewContext(source, context);
  const ui = context.window.MarsWeather.init({ $, listen: (node, type, handler) => handlers.set(node, handler),
    setStatus(id, text, warning = false) { $(id).textContent = text; $(id).warning = warning; },
    requests: { read: url => url.includes('insight_weather') ? Promise.resolve(archive) : fetchRems() },
    closeSitePopup() {}, isDisposed: () => disposed });
  return { $, storage, click: id => handlers.get($(id))(), dispose() { disposed = true; ui.dispose(); } };
}
const record = (sol, date, extra = {}) => ({ sol, terrestrial_date: date, pressure: '700', min_temp: '-90', max_temp: '-15', ...extra });

test('cached weather renders sorted observations and date/age even when offline', async () => {
  const ui = panel({ at: Date.now(), records: [record('1', '2026-01-01'), record('2', '2026-01-02')] },
    async () => { throw new Error('offline'); });
  ui.click('open-rems');
  assert.equal(ui.$('rems-sol').textContent, '2');
  assert.match(ui.$('rems-status').textContent, /2026-01-02.*days old/);
  await ui.click('rems-refresh');
  assert.match(ui.$('rems-status').textContent, /unreachable.*2026-01-02/);
  assert.equal(ui.$('rems-status').warning, true);
  ui.click('close-rems');
  ui.click('open-rems');
  assert.match(ui.$('rems-status').textContent, /unreachable/);
  assert.equal(ui.$('rems-status').warning, true);
  ui.dispose();
});
test('refresh recovers after failure, sanitizes fields, and retains newer cached sols', async () => {
  let attempts = 0;
  const ui = panel({ at: Date.now(), records: [record('5', '2026-01-05')] }, async () => {
    if (++attempts === 1) throw new Error('timeout');
    return { soles: [record('3', '2026-01-03', { pressure: 'invalid' }), record('2', '2026-01-02')] };
  });
  await ui.click('rems-refresh');
  await ui.click('rems-refresh');
  assert.equal(ui.$('rems-sol').textContent, '5');
  assert.equal(ui.$('rems-status').warning, false);
  ui.click('close-rems');
  ui.click('open-rems');
  assert.equal(ui.$('rems-status').warning, false);
  const cached = JSON.parse(ui.storage.get('mars-rems-observations-v1'));
  assert.deepEqual(cached.records.map(r => r.sol), ['5', '3', '2']);
  assert.equal(cached.records[1].pressure, null);
  ui.dispose();
});
test('invalid cache is ignored and late responses cannot update disposed panels', async () => {
  let resolve;
  const ui = panel({ at: Date.now() + 60000, records: [record('8', '2026-01-08')] },
    () => new Promise(done => { resolve = done; }));
  const pending = ui.click('rems-refresh');
  ui.dispose();
  resolve({ soles: [record('9', '2026-01-09')] });
  await pending;
  assert.equal(ui.$('rems-sol').textContent, '');
});
