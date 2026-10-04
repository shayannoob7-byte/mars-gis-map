const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequests, normalizeRems, selectNasaWeather } = require('../data-services.js');
const archive = require('../data/insight-weather-response.json');

test('InSight selects the newest complete valid archive observation', () => {
  assert.deepEqual(selectNasaWeather(archive), {
    sol: '681', temperature: -62.434, pressure: 743.55,
    firstUTC: '2020-10-25T22:29:51Z', lastUTC: '2020-10-26T23:09:26Z'
  });
  const invalid = structuredClone(archive);
  invalid.validity_checks['681'].AT.valid = false;
  assert.equal(selectNasaWeather(invalid).sol, '680');
  assert.throws(() => selectNasaWeather({ sol_keys: [] }));
});
test('REMS sorts shuffled records, deduplicates sols, and rejects invalid dates', () => {
  const records = normalizeRems([
    { sol: '12', terrestrial_date: '2026-01-02', pressure: '700' },
    { sol: '14', terrestrial_date: '2026-01-04', pressure: '710' },
    { sol: '13', terrestrial_date: '2026-01-03' },
    { sol: '14', terrestrial_date: '2026-01-04' },
    { sol: '15', terrestrial_date: '2026-02-30' }, null
  ]);
  assert.deepEqual(records.map(r => r.sol), ['14', '13', '12']);
  assert.equal(records[0].pressure, 710);
  assert.deepEqual(normalizeRems(records), records, 'cached records use the same validation');
});
test('REMS retains partial observations but hides malformed numeric fields', () => {
  const [record] = normalizeRems([{ sol: '1', terrestrial_date: '2026-01-01',
    min_temp: '-20', max_temp: '-90', pressure: '-1', ls: 'Infinity',
    min_gts_temp: '--', max_gts_temp: {}, sunrise: '99:99', sunset: '18:30:00',
    atmo_opacity: { invalid: true } }]);
  for (const key of ['min_temp', 'max_temp', 'pressure', 'ls', 'min_gts_temp', 'max_gts_temp']) assert.equal(record[key], null);
  assert.equal(record.sunrise, '');
  assert.equal(record.sunset, '18:30:00');
  assert.equal(record.atmo_opacity, '');
});
test('request deadline covers a stalled fetch and allows retry', async () => {
  let count = 0, signal;
  const requests = createRequests(async (url, options) => {
    signal = options.signal;
    if (++count === 1) return new Promise(() => {});
    return { ok: true, json: async () => ({ recovered: true }) };
  }, 20);
  await assert.rejects(requests.read('test'), /timed out/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await requests.read('test'), { recovered: true });
});
test('request deadline covers stalled response bodies', async () => {
  const requests = createRequests(async () => ({ ok: true, text: () => new Promise(() => {}) }), 20);
  await assert.rejects(requests.read('test', 'text'), /timed out/);
});
test('disposal aborts all active requests and HTTP errors reject', async () => {
  const requests = createRequests(() => new Promise(() => {}), 10000);
  const a = requests.read('a'), b = requests.read('b');
  requests.abortAll();
  await Promise.all([assert.rejects(a, /cancelled/), assert.rejects(b, /cancelled/)]);
  await assert.rejects(createRequests(async () => ({ ok: false, status: 503 })).read('test'), /503/);
});
