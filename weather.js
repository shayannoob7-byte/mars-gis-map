/* Weather panels are independent of Cesium and can be tested with a DOM adapter. */
window.MarsWeather = Object.freeze({
  init({ $, listen, setStatus, requests, closeSitePopup, isDisposed }) {
  const { validWeather, newerWeather, selectNasaWeather, normalizeRems } = window.MarsData;
  let weatherInFlight = false;
  const WEATHER_URL = 'https://api.nasa.gov/insight_weather/?api_key=DEMO_KEY&feedtype=json&ver=1.0';
  const WEATHER_CACHE_KEY = 'mars-insight-observations-v1';
  const WEATHER_CHECK_KEY = 'mars-insight-check-v1';
  const WEATHER_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
  // Actual NASA API response retrieved 2026-10-03; AT and PRE validity
  // flags were both true. Original response: data/insight-weather-response.json.
  // Embedded so the single-file preview also retains genuine observations.
  const NASA_ARCHIVE = Object.freeze({
    sol: '681', temperature: -62.434, pressure: 743.55,
    firstUTC: '2020-10-25T22:29:51Z', lastUTC: '2020-10-26T23:09:26Z'
  });
  let currentWeather = NASA_ARCHIVE;
  let lastWeatherCheck = 0;
  function renderWeather(status) {
    $('weather-sol').textContent = currentWeather.sol;
    $('weather-temp').textContent = `${currentWeather.temperature.toFixed(3)} °C`;
    $('weather-pressure').textContent = `${currentWeather.pressure.toFixed(2)} Pa`;
    $('weather-date').textContent = currentWeather.lastUTC.slice(0, 10);
    $('weather-date').title = `${currentWeather.firstUTC} to ${currentWeather.lastUTC}`;
    setStatus('weather-status', status);
  }
  // Cache successful observations and throttle checks across page reloads.
  // Storage may be blocked; the bundled NASA observation still works.
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
    if (validWeather(cached) && newerWeather(cached, currentWeather)) currentWeather = cached;
    const checked = Number(localStorage.getItem(WEATHER_CHECK_KEY));
    if (Number.isFinite(checked) && checked <= Date.now()) lastWeatherCheck = checked;
  } catch (error) { /* Storage is optional. */ }
  renderWeather('Verified NASA archive · Saved observations.');
  async function loadWeather() {
    if (isDisposed() || weatherInFlight || Date.now() - lastWeatherCheck < WEATHER_CHECK_INTERVAL) return;
    lastWeatherCheck = Date.now();
    try { localStorage.setItem(WEATHER_CHECK_KEY, String(lastWeatherCheck)); } catch (error) { /* Optional cache. */ }
    weatherInFlight = true;
    try {
      const observation = selectNasaWeather(await requests.read(WEATHER_URL));
      if (isDisposed()) return;
      if (newerWeather(observation, currentWeather)) {
        currentWeather = observation;
        try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(currentWeather)); } catch (error) { /* Optional cache. */ }
        renderWeather('Verified NASA archive · Latest valid record returned by the API.');
      } else renderWeather('Verified NASA archive · Retaining the newer saved observation.');
    } catch (error) {
      if (isDisposed()) return;
      renderWeather('Verified NASA archive · Saved observations; API refresh unavailable.');
    } finally { weatherInFlight = false; }
  }
  loadWeather();
  const weatherRefresh = window.setInterval(() => { if (!document.hidden) loadWeather(); }, 30 * 60 * 1000);
  // Curiosity REMS overview tab. Source: NASA's public outreach weather feed
  // (CORS-open, no key). Observations are delayed; show their date and age.
  const REMS_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';
  const REMS_CACHE_KEY = 'mars-rems-observations-v1';
  const REMS_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
  const REMS_HISTORY_ROWS = 10;
  let remsRecords = null, remsLastCheck = 0, remsInFlight = false, remsPreviousFocus = null;
  let remsFailed = false;
  function remsValue(value) {
    return value !== undefined && value !== null && value !== '' && value !== '--' ? String(value) : '—';
  }
  function remsLagDays(date) {
    const time = Date.parse(date);
    return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 86400000)) : null;
  }
  function renderRems(status, warning = false) {
    const latest = remsRecords?.[0];
    if (!latest) return;
    $('rems-sol').textContent = remsValue(latest.sol);
    $('rems-date').textContent = remsValue(latest.terrestrial_date);
    $('rems-ls').textContent = `${remsValue(latest.ls)}°${latest.season ? ` · ${latest.season}` : ''}`;
    $('rems-temps').textContent = `${remsValue(latest.min_temp)} °C / ${remsValue(latest.max_temp)} °C`;
    $('rems-ground').textContent = `${remsValue(latest.min_gts_temp)} °C / ${remsValue(latest.max_gts_temp)} °C`;
    $('rems-pressure').textContent = latest.pressure && latest.pressure !== '--'
      ? `${latest.pressure} Pa${latest.pressure_string ? ` · ${latest.pressure_string}` : ''}` : '—';
    $('rems-sky').textContent = remsValue(latest.atmo_opacity);
    $('rems-uv').textContent = remsValue(latest.local_uv_irradiance_index);
    $('rems-sun').textContent = `${remsValue(latest.sunrise)} · ${remsValue(latest.sunset)}`;
    const rows = remsRecords.slice(0, REMS_HISTORY_ROWS).map((record) => {
      const tr = document.createElement('tr');
      [record.sol, record.terrestrial_date, record.min_temp, record.max_temp, record.pressure].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = remsValue(value);
        tr.append(td);
      });
      return tr;
    });
    $('rems-history').replaceChildren(...rows);
    const lag = remsLagDays(latest.terrestrial_date);
    setStatus('rems-status', `${status} Observation: ${latest.terrestrial_date}${lag !== null ? ` · ${lag} days old` : ''}.`, warning);
  }
  async function loadRems(force = false) {
    if (isDisposed() || remsInFlight) return;
    if (!force && remsRecords && Date.now() - remsLastCheck < REMS_CHECK_INTERVAL) {
      renderRems(remsFailed ? 'NASA feed unreachable; showing saved observations.'
        : 'Saved observations · Checked on opening after 6 hours, or use Refresh feed.', remsFailed);
      return;
    }
    remsInFlight = true;
    setStatus('rems-status', 'Requesting NASA REMS observations…');
    try {
      const payload = await requests.read(REMS_URL);
      if (isDisposed()) return;
      const records = normalizeRems(payload?.soles);
      if (!records.length) throw new Error('Feed returned no usable sols.');
      remsRecords = normalizeRems([...records, ...(remsRecords || [])]).slice(0, 60);
      remsLastCheck = Date.now();
      remsFailed = false;
      // Trim the cache to the displayed window so storage stays small.
      try { localStorage.setItem(REMS_CACHE_KEY, JSON.stringify({ at: remsLastCheck, records: remsRecords })); } catch (error) { /* Optional cache. */ }
      renderRems('NASA feed checked · Latest available observations; not live weather.');
    } catch (error) {
      if (isDisposed()) return;
      remsFailed = true;
      if (remsRecords) renderRems('NASA feed unreachable; showing saved observations.', true);
      else setStatus('rems-status', 'NASA REMS feed unreachable. Check the connection, then use Refresh feed.', true);
    } finally { remsInFlight = false; }
  }
  // Restore saved observations so the tab has content before the first fetch.
  try {
    const cached = JSON.parse(localStorage.getItem(REMS_CACHE_KEY) || 'null');
    const records = normalizeRems(cached?.records);
    if (cached && Number.isFinite(cached.at) && cached.at >= 0 && cached.at <= Date.now() && records.length) {
      remsRecords = records.slice(0, 60);
      remsLastCheck = cached.at;
    }
  } catch (error) { /* Optional cache. */ }
  function closeRems() {
    if ($('rems-panel').hidden) return;
    $('rems-panel').hidden = true;
    remsPreviousFocus?.focus?.();
  }
  function openRems() {
    remsPreviousFocus = document.activeElement;
    $('rems-panel').hidden = false;
    closeSitePopup();
    $('rems-panel').scrollTop = 0;
    $('close-rems').focus();
    loadRems();
  }
  listen($('open-rems'), 'click', openRems);
  listen($('close-rems'), 'click', closeRems);
  listen($('rems-refresh'), 'click', () => loadRems(true));
  return { closeRems, dispose() { window.clearInterval(weatherRefresh); } };
  }
});
