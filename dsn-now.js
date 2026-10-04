(function (root) {
  'use strict';
  const FEED = 'https://eyes.nasa.gov/dsn/data/dsn.xml';
  const CONFIG = 'https://eyes.nasa.gov/apps/dsn-now/config.xml';
  const MARS_CODES = new Set(['M01O', 'M01S', 'M20', 'MRO', 'MROS', 'MSL', 'MVN', 'MEX', 'EMM', 'TGO', 'NSYT', 'MER1', 'MER2', 'MOM', 'MGS', 'ESCB', 'ESCG']);
  function numeric(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function parseDocument(doc) {
    if (doc.querySelector('parsererror') || doc.documentElement?.tagName !== 'dsn') throw new Error('Invalid DSN XML');
    const stations = []; let station = null;
    // NASA uses sibling station markers followed by dishes, not nested stations.
    for (const node of doc.documentElement.children) {
      const attr = name => node.getAttribute(name);
      if (node.tagName === 'station') {
        station = { name: attr('friendlyName') || attr('name'), timestamp: numeric(attr('timeUTC')), dishes: [] };
        stations.push(station);
      } else if (node.tagName === 'dish' && station) {
        const targets = [...node.querySelectorAll('target')].map(target => target.getAttribute('name')).filter(Boolean);
        const signals = [...node.querySelectorAll('upSignal, downSignal')].map(signal => ({
          direction: signal.tagName === 'upSignal' ? 'Uplink' : 'Downlink',
          active: signal.getAttribute('active') === 'true', spacecraft: signal.getAttribute('spacecraft') || 'Unknown',
          rate: numeric(signal.getAttribute('dataRate')), band: signal.getAttribute('band') || 'Unknown',
          type: signal.getAttribute('signalType') || 'Unknown'
        }));
        station.dishes.push({ name: attr('name'), activity: attr('activity') || 'Not reported',
          azimuth: numeric(attr('azimuthAngle')), elevation: numeric(attr('elevationAngle')), targets, signals,
          mars: [...targets, ...signals.map(signal => signal.spacecraft)].some(code => MARS_CODES.has(code.toUpperCase())) });
      }
    }
    if (!stations.length || !stations.some(item => item.dishes.length)) throw new Error('No station data');
    const timestamp = numeric(doc.querySelector('timestamp')?.textContent);
    return { stations, timestamp: timestamp && timestamp <= 8640000000000000 ? timestamp : null };
  }
  function freshness(timestamp, now = Date.now()) {
    if (!timestamp) return 'Source timestamp unavailable';
    const age = (now - timestamp) / 1000;
    if (age < -60) return 'Source clock is ahead; freshness uncertain';
    return age > 120 ? `STALE source data · ${Math.floor(age / 60)} minutes old` : `Source age: ${Math.max(0, Math.floor(age))} seconds`;
  }
  function rateLabel(signal) {
    if (!signal.active) return 'Inactive';
    if (signal.rate === null) return 'Rate unavailable';
    if (signal.rate === 0) return '0 bps reported';
    const scale = signal.rate >= 1e6 ? 1e6 : signal.rate >= 1e3 ? 1e3 : 1;
    return `${Number((signal.rate / scale).toFixed(3))} ${scale === 1e6 ? 'Mbps' : scale === 1e3 ? 'kbps' : 'bps'}`;
  }
  const api = { parseDocument, freshness, rateLabel, numeric };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.MarsDSN = Object.freeze(api);
  const $ = id => document.getElementById(id), dialog = $('dsn-panel');
  const requests = root.MarsData.createRequests();
  let snapshot = null, names = new Map(), timer = null, generation = 0, busy = false, previousFocus = null, failed = false;
  function xml(text) { return new DOMParser().parseFromString(text, 'application/xml'); }
  function element(tag, text, className) {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function render() {
    if (!snapshot) return;
    $('dsn-status').textContent = `${failed ? 'Refresh unavailable; retaining last response. ' : ''}${freshness(snapshot.timestamp)}. ${snapshot.timestamp ? 'NASA timestamp: ' + new Date(snapshot.timestamp).toISOString() : ''}`;
    $('dsn-status').classList.toggle('warning', failed || !snapshot.timestamp || Math.abs(Date.now() - snapshot.timestamp) > 120000);
    const marsOnly = $('dsn-mars').checked;
    const sections = snapshot.stations.map(station => {
      const section = element('section', '', 'dsn-station');
      section.append(element('h3', station.name));
      const dishes = station.dishes.filter(dish => !marsOnly || dish.mars);
      if (!dishes.length) section.append(element('p', 'No Mars-related antennas in this response.', 'help-text'));
      for (const dish of dishes) {
        const card = element('article', '', 'dsn-dish');
        const active = dish.signals.filter(signal => signal.active);
        card.append(element('h4', `${dish.name} · ${active.length ? 'Signal active' : 'No active signal reported'}`));
        const targets = [...new Set([...dish.targets, ...dish.signals.map(signal => signal.spacecraft)])];
        card.append(element('p', targets.map(code => names.get(code.toLowerCase()) || code).join(' · ') || 'No target reported', 'dsn-target'));
        card.append(element('p', dish.activity, 'help-text'));
        card.append(element('p', `Azimuth ${dish.azimuth ?? '—'}° · Elevation ${dish.elevation ?? '—'}°`, 'help-text'));
        for (const signal of dish.signals) {
          card.append(element('p', `${signal.direction} · ${signal.spacecraft} · ${signal.band} band · ${signal.active ? 'Active' : 'Inactive'} · ${rateLabel(signal)}`, signal.active ? 'dsn-signal active' : 'dsn-signal'));
        }
        section.append(card);
      }
      return section;
    });
    $('dsn-stations').replaceChildren(...sections);
  }
  async function refresh() {
    if (busy || !dialog.open || document.hidden) return;
    busy = true; const current = generation;
    $('dsn-refresh').disabled = true;
    if (!snapshot) $('dsn-status').textContent = 'Requesting NASA DSN station data…';
    try {
      const text = await requests.read(`${FEED}?_=${Date.now()}`, 'text');
      if (current !== generation) return;
      const next = parseDocument(xml(text));
      if (!snapshot?.timestamp || (next.timestamp && next.timestamp >= snapshot.timestamp)) snapshot = next;
      failed = false; render();
    } catch {
      if (current !== generation) return;
      failed = true;
      if (snapshot) render();
      else $('dsn-status').textContent = 'NASA DSN feed unavailable. Refresh to retry, or open NASA DSN Now below.';
    } finally {
      if (current === generation) { busy = false; $('dsn-refresh').disabled = false; }
    }
  }
  async function loadNames() {
    if (names.size) return;
    const current = generation;
    try {
      const doc = xml(await requests.read(CONFIG, 'text'));
      if (current !== generation) return;
      names = new Map([...doc.querySelectorAll('spacecraft')].map(node => [node.getAttribute('name'), node.getAttribute('friendlyName')]));
      if (dialog.open) render();
    } catch { /* Codes remain usable without the optional mission-name catalog. */ }
  }
  function stop() { ++generation; busy = false; clearInterval(timer); timer = null; requests.abortAll(); }
  function start() {
    if (!dialog.open) return;
    render(); refresh(); loadNames();
    if (timer === null) timer = setInterval(() => { if (!document.hidden) { render(); refresh(); } }, 15000);
  }
  $('open-dsn').addEventListener('click', () => {
    previousFocus = document.activeElement; dialog.showModal(); $('close-dsn').focus(); start();
  });
  $('close-dsn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { stop(); previousFocus?.focus(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  $('dsn-refresh').addEventListener('click', refresh);
  $('dsn-mars').addEventListener('change', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) { render(); refresh(); } });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})(typeof window === 'object' ? window : globalThis);
