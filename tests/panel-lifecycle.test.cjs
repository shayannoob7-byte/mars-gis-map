const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function panel(file) {
  const nodes = new Map(), events = {}, timers = new Map(), requests = [];
  let nextTimer = 0;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      handlers: {}, dataset: {}, value: '', textContent: '', open: false,
      addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() {}, showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close?.(); },
      querySelector() { return null; }, replaceChildren() {}, setAttribute() {}, getAttribute() { return null; }
    });
    return nodes.get(id);
  };
  const document = { getElementById: $, hidden: false, activeElement: null,
    addEventListener(type, handler) { events[type] = handler; } };
  const window = { addEventListener(type, handler) { events[type] = handler; },
    MarsData: { createRequests: () => ({ abortAll() {}, read(url) {
      requests.push(url);
      return Promise.resolve({ collection: { items: [] } });
    } }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    window, document, URL, URLSearchParams,
    setInterval(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  return { $, events, timers, requests };
}

test('DSN resumes polling after cached restoration without duplicate timers or reopening closed panels', async () => {
  const ui = panel('dsn-now.js');
  ui.$('open-dsn').handlers.click();
  await new Promise(setImmediate);
  assert.equal(ui.timers.size, 1);
  ui.events.pagehide({ persisted: true });
  assert.equal(ui.timers.size, 0);
  const before = ui.requests.length;
  ui.events.pageshow({ persisted: true });
  await new Promise(setImmediate);
  assert.equal(ui.timers.size, 1);
  assert.ok(ui.requests.length > before);
  ui.events.pageshow({ persisted: true });
  await new Promise(setImmediate);
  assert.equal(ui.timers.size, 1);
  const restored = ui.requests.length;
  [...ui.timers.values()][0]();
  await new Promise(setImmediate);
  assert.ok(ui.requests.length > restored, 'periodic refresh resumes');
  ui.$('close-dsn').handlers.click();
  ui.events.pageshow({ persisted: true });
  assert.equal(ui.timers.size, 0);
});

test('media heading follows manual searches and the blank-query fallback', async () => {
  const ui = panel('media-library.js');
  ui.$('site-media').dataset.query = 'Gale Crater';
  ui.$('site-media').handlers.click({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.match(ui.$('media-heading').textContent, /Gale Crater$/);
  for (const [input, expected] of [['Olympus Mons', 'Olympus Mons'], ['   ', 'Mars']]) {
    ui.$('media-query').value = input;
    ui.$('media-form').handlers.submit({ preventDefault() {} });
    await new Promise(setImmediate);
    assert.ok(ui.$('media-heading').textContent.endsWith(expected));
    assert.equal(new URL(ui.requests.at(-1)).searchParams.get('q'), expected);
  }
});
