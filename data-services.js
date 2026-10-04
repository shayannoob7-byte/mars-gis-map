/* Shared, testable data validation and bounded network requests. */
(function (root) {
  'use strict';
  function createRequests(fetcher = (...args) => fetch(...args), timeoutMs = 10000) {
    const active = new Set();
    async function read(url, format = 'json') {
      const controller = new AbortController();
      active.add(controller);
      let timer;
      const aborted = new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Request cancelled or timed out.')), { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
      });
      try {
        // The deadline covers body consumption as well as response headers.
        return await Promise.race([aborted, (async () => {
          const response = await fetcher(url, { signal: controller.signal, credentials: 'omit',
            headers: { Accept: format === 'json' ? 'application/json' : 'application/xml' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response[format]();
        })()]);
      } finally { clearTimeout(timer); active.delete(controller); }
    }
    return Object.freeze({ read, abortAll() { for (const controller of active) controller.abort(); } });
  }
  function validWeather(record) {
    return record && /^\d+$/.test(String(record.sol)) &&
      Number.isFinite(record.temperature) && Number.isFinite(record.pressure) &&
      record.pressure > 0 && Number.isFinite(Date.parse(record.firstUTC)) &&
      Number.isFinite(Date.parse(record.lastUTC)) &&
      Date.parse(record.firstUTC) <= Date.parse(record.lastUTC);
  }
  function newerWeather(candidate, existing) {
    return Date.parse(candidate.lastUTC) >= Date.parse(existing.lastUTC);
  }
  function selectNasaWeather(data) {
    const keys = Array.isArray(data?.sol_keys) ? data.sol_keys : [];
    for (const sol of [...keys].filter(key => /^\d+$/.test(String(key))).sort((a, b) => Number(b) - Number(a))) {
      const record = data[sol], quality = data.validity_checks?.[sol];
      if (quality?.AT?.valid !== true || quality?.PRE?.valid !== true) continue;
      const observation = { sol: String(sol), temperature: record?.AT?.av, pressure: record?.PRE?.av,
        firstUTC: record?.First_UTC, lastUTC: record?.Last_UTC };
      if (validWeather(observation)) return observation;
    }
    throw new Error('NASA returned no complete, validated weather record.');
  }
  function numberOrNull(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function normalizeRems(input) {
    const records = [];
    for (const item of Array.isArray(input) ? input : []) {
      if (!item || !/^\d+$/.test(String(item.sol)) || !Number.isSafeInteger(Number(item.sol))) continue;
      const date = item.terrestrial_date;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const time = Date.parse(date);
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) continue;
      const record = { sol: String(Number(item.sol)), terrestrial_date: date };
      for (const key of ['min_temp', 'max_temp', 'min_gts_temp', 'max_gts_temp', 'pressure', 'ls']) {
        record[key] = numberOrNull(item[key]);
      }
      for (const [low, high] of [['min_temp', 'max_temp'], ['min_gts_temp', 'max_gts_temp']]) {
        if (record[low] !== null && record[low] < -273.15) record[low] = null;
        if (record[high] !== null && record[high] < -273.15) record[high] = null;
        if (record[low] !== null && record[high] !== null && record[low] > record[high]) record[low] = record[high] = null;
      }
      if (record.pressure !== null && record.pressure <= 0) record.pressure = null;
      if (record.ls !== null && (record.ls < 0 || record.ls > 360)) record.ls = null;
      for (const key of ['season', 'pressure_string', 'atmo_opacity', 'local_uv_irradiance_index']) {
        record[key] = typeof item[key] === 'string' && item[key].trim() !== '--' ? item[key].trim().slice(0, 120) : '';
      }
      for (const key of ['sunrise', 'sunset']) {
        record[key] = typeof item[key] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item[key]) ? item[key] : '';
      }
      records.push(record);
    }
    // Date is the observation timestamp; sol breaks ties. Never trust feed order.
    records.sort((a, b) => b.terrestrial_date.localeCompare(a.terrestrial_date) || Number(b.sol) - Number(a.sol));
    const seen = new Set();
    return records.filter(record => { if (seen.has(record.sol)) return false; seen.add(record.sol); return true; });
  }
  const api = Object.freeze({ createRequests, validWeather, newerWeather, selectNasaWeather, normalizeRems });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarsData = api;
})(typeof window === 'object' ? window : globalThis);
