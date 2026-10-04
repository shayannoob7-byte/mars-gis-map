const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDocument, freshness, rateLabel, numeric } = require('../dsn-now.js');
// Minimal DOM fixtures model the feed's unusual sibling station/dish layout.
function node(tagName, attributes = {}, children = []) {
  return { tagName, children, getAttribute: key => attributes[key] ?? null,
    querySelectorAll: selector => children.filter(child => selector.split(', ').includes(child.tagName)) };
}
function document(children, timestamp = '1700000000000') {
  return { documentElement: node('dsn', {}, children), querySelector: tag => tag === 'timestamp' ? { textContent: timestamp } : null };
}
test('DSN groups sibling dishes by station and preserves multiple signals', () => {
  const result = parseDocument(document([
    node('station', { name: 'gdscc', friendlyName: 'Goldstone' }),
    node('dish', { name: 'DSS24', azimuthAngle: '0', elevationAngle: '50' }, [
      node('target', { name: 'MRO' }),
      node('upSignal', { active: 'true', spacecraft: 'MRO', dataRate: '0', band: 'X' }),
      node('downSignal', { active: 'false', spacecraft: 'MRO', dataRate: '1500000' })]),
    node('station', { friendlyName: 'Madrid' }), node('dish', { name: 'DSS54' }, [node('target', { name: 'JNO' })])
  ]));
  assert.equal(result.stations.length, 2);
  assert.equal(result.stations[0].dishes[0].mars, true);
  assert.equal(result.stations[0].dishes[0].azimuth, 0);
  assert.equal(result.stations[0].dishes[0].signals.length, 2);
  assert.equal(result.stations[1].dishes[0].mars, false);
  assert.equal(result.timestamp, 1700000000000);
});
test('DSN sentinel values are missing; inactive rates are never labeled as traffic', () => {
  for (const value of ['', null, undefined, '-1', 'NaN']) assert.equal(numeric(value), null);
  assert.equal(numeric('0'), 0);
  assert.equal(rateLabel({ active: false, rate: 1500000 }), 'Inactive');
  assert.equal(rateLabel({ active: true, rate: 1500000 }), '1.5 Mbps');
  assert.equal(rateLabel({ active: true, rate: 8192 }), '8.192 kbps');
  assert.equal(rateLabel({ active: true, rate: null }), 'Rate unavailable');
});
test('DSN freshness distinguishes stale, missing, and future source times', () => {
  assert.match(freshness(null), /unavailable/);
  assert.match(freshness(1000000, 1015000), /15 seconds/);
  assert.match(freshness(1000000, 1300000), /STALE/);
  assert.match(freshness(1300000, 1000000), /ahead/);
});
test('DSN rejects malformed or empty documents', () => {
  assert.throws(() => parseDocument(document([])), /No station data/);
  assert.throws(() => parseDocument({ documentElement: node('html'), querySelector: () => null }), /Invalid DSN/);
  assert.throws(() => parseDocument({ querySelector: () => ({}) }), /Invalid DSN/);
});
