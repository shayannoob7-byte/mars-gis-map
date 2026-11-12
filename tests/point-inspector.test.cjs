const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('point inspection loads terrain and prevents cleared selections from receiving stale results', async () => {
  const nodes = new Map(), handlers = {}, pending = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', disabled: false, handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      removeEventListener() {}, append() {}, replaceChildren() {},
      classList: { toggle() {} }
    });
    return nodes.get(id);
  };
  const document = { getElementById: node, createElement: () => node(Symbol()) };
  const window = {
    addEventListener(type, fn) { handlers[type] = fn; }, removeEventListener() {},
    MarsScienceData: { missions: [], decodeMola: () => ({}),
      sampleElevation: (_, latitude) => ({ elevationM: latitude * 100 }),
      calculateLocalSlope: () => ({ valid: true, degrees: 1.25 }) },
    MarsTerrainModel: { REGIONS: [], attachViewer: () => ({ destroy() {} }) },
    MarsData: { createRequests: () => ({ abortAll() {}, read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../science-explorer.js'), 'utf8'), { window, document, Intl });
  const select = detail => handlers['mars-location-change']({ detail });
  const first = select({ latitude: 1, longitude: 0 });
  await select(null);
  pending.splice(0).forEach(p => p.resolve(new ArrayBuffer(0)));
  await first;
  assert.equal(node('point-elevation').textContent, 'Not loaded');
  assert.equal(node('point-provenance').disabled, true);
  await select({ latitude: 2, longitude: 0 });
  assert.match(node('point-elevation').textContent, /200 m/);
  assert.match(node('point-slope').textContent, /1.25/);
  assert.equal(node('point-provenance').disabled, false);
  await select(null);
  assert.equal(node('point-slope').textContent, 'Not loaded');
});
