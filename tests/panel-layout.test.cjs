const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(compact = false, saved = {}) {
  const nodes = new Map(), events = {};
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { handlers: {}, attrs: {}, inert: false, scrollTop: 0,
        classList: { toggle(c, yes) { yes ? classes.add(c) : classes.delete(c); }, contains: c => classes.has(c) },
        addEventListener(e, fn) { this.handlers[e] = fn; }, setAttribute(k, v) { this.attrs[k] = v; },
        focus() { document.activeElement = this; }, contains(el) { return el === this; } });
    }
    return nodes.get(id);
  };
  const media = { matches: compact, addEventListener(_, fn) { this.change = fn; } };
  const document = { getElementById: node, activeElement: null, body: node('body'), querySelector: () => null,
    addEventListener(e, fn) { events[e] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../panel-layout.js'), 'utf8'), {
    document, window: { matchMedia: () => media }, localStorage: {
      getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; }
    }
  });
  return { node, media, events, saved, click: id => node(id).handlers.click() };
}
test('desktop panels independently minimize and restore with accessible state', () => {
  const ui = setup();
  assert.equal(ui.node('telemetry-bar').inert, false);
  ui.click('minimize-telemetry');
  assert.equal(ui.node('telemetry-bar').inert, true);
  assert.equal(ui.node('toggle-telemetry').attrs['aria-expanded'], 'false');
  assert.equal(ui.node('control-panel').inert, false);
  ui.click('toggle-telemetry');
  assert.equal(ui.node('telemetry-bar').inert, false);
});
test('mobile starts clear, opens one panel at a time, and Escape minimizes', () => {
  const ui = setup(true);
  assert.equal(ui.node('telemetry-bar').inert, true);
  assert.equal(ui.node('control-panel').inert, true);
  ui.click('toggle-controls');
  assert.equal(ui.node('control-panel').inert, false);
  ui.click('toggle-telemetry');
  assert.equal(ui.node('control-panel').inert, true);
  assert.equal(ui.node('telemetry-bar').inert, false);
  ui.events.keydown({ key: 'Escape' });
  assert.equal(ui.node('telemetry-bar').inert, true);
});
test('desktop and compact preferences survive resizing independently', () => {
  const ui = setup();
  ui.click('minimize-controls');
  ui.media.matches = true; ui.media.change();
  ui.click('toggle-controls');
  ui.media.matches = false; ui.media.change();
  assert.equal(ui.node('telemetry-bar').inert, false);
  assert.equal(ui.node('control-panel').inert, true);
  ui.media.matches = true; ui.media.change();
  assert.equal(ui.node('telemetry-bar').inert, true);
  assert.equal(ui.node('control-panel').inert, false);
});
test('invalid persisted state falls back to compact defaults', () => {
  const ui = setup(true, { 'mars-panels-v1-compact': '["yes"]' });
  assert.equal(ui.node('control-panel').inert, true);
});
