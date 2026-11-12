(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const data = window.MarsScienceData;
  const terrainModel = window.MarsTerrainModel;
  const globe = window.MarsGlobe;
  const dialog = $('science-panel');
  const requests = window.MarsData.createRequests();
  const cleanups = [];
  let grid = null, gridPromise = null;
  let selectedMission = null, disposed = false;
  let terrainViewer = null, selectedTerrainPatch = null, selectedTerrainSource = null;
  let pointRequest = 0, pointSample = null;

  async function inspectPoint(event) {
    const request = ++pointRequest;
    pointSample = null;
    $('point-provenance').disabled = true;
    $('point-elevation').textContent = event.detail ? 'Loading…' : 'Not loaded';
    $('point-slope').textContent = event.detail ? 'Loading…' : 'Not loaded';
    if (!event.detail) return;
    try {
      const { latitude, longitude } = event.detail;
      const loaded = await loadGrid();
      if (disposed || request !== pointRequest) return;
      pointSample = data.sampleElevation(loaded, latitude, longitude);
      const slope = data.calculateLocalSlope(loaded, latitude, longitude);
      $('point-elevation').textContent = `${Math.round(pointSample.elevationM).toLocaleString()} m above MOLA areoid`;
      $('point-slope').textContent = slope.valid ? `${slope.degrees.toFixed(2)}° · coarse grid` : 'Unavailable near poles';
      $('point-provenance').disabled = false;
    } catch (error) {
      if (disposed || request !== pointRequest) return;
      $('point-elevation').textContent = 'Unavailable';
      $('point-slope').textContent = error.message;
    }
  }

  function listen(element, type, callback) {
    element.addEventListener(type, callback);
    cleanups.push(() => element.removeEventListener(type, callback));
  }

  function setTerrainModelStatus(message, warning = false) {
    $('terrain-model-status').textContent = message;
    $('terrain-model-status').classList.toggle('warning', warning);
  }

  function renderTerrainModel() {
    if (!selectedTerrainPatch || !terrainViewer) return;
    const extentKm = Number($('terrain-patch-size').value);
    const custom = $('terrain-region-select').value === 'custom';
    const mesh = terrainModel.buildMesh(selectedTerrainPatch, extentKm, 3, custom ? 48 : 128);
    terrainViewer.setModel(mesh);
    $('reset-terrain-model').disabled = false;
    $('terrain-model-caption').textContent =
      `${selectedTerrainSource} · ${extentKm} × ${extentKm} km · sampled elevation ` +
      `${Math.round(mesh.minimumElevationM).toLocaleString()} to ${Math.round(mesh.maximumElevationM).toLocaleString()} m ` +
      `above the MOLA GMM3 areoid · 3× vertical exaggeration. ` +
      (custom
        ? `Global 4-pixel/degree source (~${(selectedTerrainPatch.resolutionMeters / 1000).toFixed(1)} km at the equator); ` +
          'the mesh interpolates this coarse grid and does not add detail.'
        : `MOLA 128-pixel/degree source (~${selectedTerrainPatch.resolutionMeters} m at the equator); ` +
          'values may be archive-interpolated where no direct altimeter observation exists.');
  }

  function initializeTerrainRegions() {
    const select = $('terrain-region-select');
    for (const region of terrainModel.REGIONS) {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.name;
      select.append(option);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom latitude / longitude · global MOLA fallback';
    select.append(custom);
    terrainViewer = terrainModel.attachViewer($('terrain-model-canvas'));
  }

  function loadGrid() {
    if (grid) return Promise.resolve(grid);
    if (gridPromise) return gridPromise;
    let pending;
    pending = Promise.all([
      requests.read('data/mola-meg004-topography.img', 'arrayBuffer'),
      requests.read('data/mola-meg004-areoid-radius-offset.img', 'arrayBuffer')
    ]).then(([topography, areoid]) => {
      if (disposed) throw new Error('Terrain loading stopped because the page is closing.');
      grid = data.decodeMola(topography, areoid);
      return grid;
    }).catch(error => {
      if (gridPromise === pending) gridPromise = null;
      throw new Error(`Bundled global MOLA data could not be loaded: ${error.message}`);
    });
    gridPromise = pending;
    return pending;
  }

  async function loadTerrainModel() {
    const selection = $('terrain-region-select').value;
    if (!selection) {
      setTerrainModelStatus('Choose a preset region or custom coordinates first.', true);
      return;
    }
    $('load-terrain-model').disabled = true;
    setTerrainModelStatus(selection === 'custom'
      ? 'Loading the global MOLA data and sampling the selected coordinates…'
      : 'Loading the selected regional MOLA terrain patch…');
    try {
      if (selection === 'custom') {
        const latitude = $('terrain-center-latitude').valueAsNumber;
        const longitude = $('terrain-center-longitude').valueAsNumber;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new TypeError('Enter finite latitude and longitude coordinates.');
        }
        selectedTerrainPatch = terrainModel.createGridPatch(
          await loadGrid(), data, latitude, longitude, 100
        );
        selectedTerrainSource = `Custom center ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°E`;
        renderTerrainModel();
        setTerrainModelStatus('Custom regional surface loaded from the bundled global MOLA grid.');
      } else {
        const region = terrainModel.REGIONS.find(candidate => candidate.id === selection);
        if (!region) throw new RangeError('The selected terrain region is not available.');
        const bytes = await requests.read(region.file, 'arrayBuffer');
        selectedTerrainPatch = terrainModel.decodePatch(bytes);
        selectedTerrainSource = `${region.name} · MOLA MEGDR 128 pixels/degree`;
        renderTerrainModel();
        setTerrainModelStatus(`Loaded ${region.name} from the bundled NASA MOLA 128-pixel/degree regional patch.`);
      }
    } catch (error) {
      setTerrainModelStatus(`3D terrain could not be loaded: ${error.message}`, true);
    } finally {
      $('load-terrain-model').disabled = false;
    }
  }

  function activateView(name) {
    const missionActive = name === 'timeline';
    $('timeline-view').hidden = !missionActive;
    $('terrain-view').hidden = missionActive;
  }

  function showScience(view = 'timeline') {
    if (!dialog.open) dialog.showModal();
    activateView(view);
    dialog.scrollTop = 0;
    $('science-heading').textContent = view === 'terrain' ? 'Terrain Explorer' : 'Mission History';
    renderMissions();
  }

  function missionDate(value) {
    if (!value) return 'Not reported';
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? 'Not reported' :
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }

  function provenanceRows(entries) {
    const target = $('provenance-content');
    target.replaceChildren();
    for (const [label, value, url] of entries) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(value);
        description.append(link);
      } else description.textContent = String(value);
      target.append(term, description);
    }
    $('provenance-panel').hidden = false;
    $('provenance-panel').scrollIntoView({ block: 'nearest' });
  }

  function openProvenance(record) {
    if (!dialog.open) dialog.showModal();
    activateView('timeline');
    $('provenance-title').textContent = `${record.mission.name} · provenance`;
    provenanceRows(record.entries);
  }

  function renderMissions() {
    const list = $('mission-list');
    list.replaceChildren();
    const query = $('mission-search').value.trim().toLocaleLowerCase();
    const statusFilter = $('mission-status-filter').value;
    const typeFilter = $('mission-type-filter').value;
    const decade = $('mission-decade-filter').value;
    const matching = data.missions.filter(mission =>
      (!query || `${mission.name} ${mission.landingSite} ${mission.operator}`.toLocaleLowerCase().includes(query)) &&
      (!statusFilter || mission.status === statusFilter) &&
      (!typeFilter || mission.type === typeFilter) &&
      (!decade || mission.landingDate.startsWith(decade)));
    for (const mission of matching) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mission-item${selectedMission?.id === mission.id ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(selectedMission?.id === mission.id));
      const name = document.createElement('strong');
      name.textContent = mission.name;
      const metadata = document.createElement('span');
      metadata.textContent = `${missionDate(mission.landingDate)} · ${mission.status}`;
      button.append(name, metadata);
      button.addEventListener('click', () => selectMission(mission));
      item.append(button);
      list.append(item);
    }
    if (!matching.length) {
      const empty = document.createElement('li');
      empty.className = 'help-text';
      empty.textContent = 'No mission matches these filters.';
      list.append(empty);
    }
  }

  function selectMission(mission) {
    selectedMission = mission;
    renderMissions();
    const detail = $('mission-detail');
    detail.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = mission.name;
    const summary = document.createElement('p');
    summary.textContent = `${mission.operator} · ${mission.type} · ${mission.status}`;
    const facts = [
      ['Launch', missionDate(mission.launchDate)],
      ['Landing / attempted landing', missionDate(mission.landingDate)],
      ['Landing site', mission.landingSite || 'Not reported'],
      ['Landing coordinates', Number.isFinite(mission.latitude)
        ? `${Math.abs(mission.latitude).toFixed(2)}°${mission.latitude < 0 ? 'S' : 'N'}, ${Math.abs(mission.longitude).toFixed(2)}°${mission.longitude < 0 ? 'W' : 'E'}`
        : 'Not reported'],
      ['Last operational / contact', missionDate(mission.lastOperationalDate)],
      ['Formal end of mission', missionDate(mission.endDate)],
      ['Status reference date', missionDate(mission.statusDate)]
    ];
    const list = document.createElement('dl');
    list.className = 'telemetry-grid mission-facts';
    for (const [label, value] of facts) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      list.append(term, description);
    }
    const note = document.createElement('p');
    note.className = 'help-text';
    note.textContent = `${mission.note} Coordinates are landing-site references, not rover positions.`;
    const source = document.createElement('a');
    source.className = 'source-link';
    source.href = mission.source;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = 'NASA mission source ↗';
    const provenance = document.createElement('button');
    provenance.type = 'button';
    provenance.className = 'hud-btn secondary';
    provenance.textContent = 'Inspect mission provenance';
    provenance.addEventListener('click', () => openProvenance({
      mission,
      entries: [
        ['Displayed record', `${mission.name} · locally curated mission metadata`],
        ['Operator', mission.operator],
        ['Landing date', missionDate(mission.landingDate)],
        ['Mission status', `${mission.status} · reference date ${missionDate(mission.statusDate)}`],
        ['Landing coordinates', Number.isFinite(mission.latitude)
          ? `${mission.latitude}, ${mission.longitude}° (latitude, east-positive longitude)` : 'Unavailable'],
        ['Source', mission.source, mission.source],
        ['Timeline reference', data.NASA_TIMELINE_SOURCE, data.NASA_TIMELINE_SOURCE],
        ['Live status', 'Not queried; status shown is static curated metadata.']
      ]
    }));
    detail.append(heading, summary, list, note, source, provenance);
    if (globe && Number.isFinite(mission.latitude) && Number.isFinite(mission.longitude)) {
      globe.flyTo(mission.latitude, mission.longitude, 220000);
    }
  }

  listen($('open-missions'), 'click', () => showScience('timeline'));
  listen(window, 'mars-location-change', inspectPoint);
  listen($('point-provenance'), 'click', () => {
    if (!pointSample) return;
    showScience('timeline');
    $('provenance-title').textContent = 'Selected elevation · provenance';
    provenanceRows([
      ['Coordinates', `${pointSample.latitude}, ${pointSample.longitude}° (planetographic latitude, east-positive longitude)`],
      ['Dataset', `${pointSample.dataset} · ${pointSample.datasetVersion}`],
      ['Vertical reference', pointSample.verticalReference],
      ['Sampling', pointSample.samplingMethod],
      ['Grid spacing at equator', `${pointSample.resolutionKmAtEquator} km`],
      ['Limitations', pointSample.qualityNote],
      ['Source', pointSample.sourceUrl, pointSample.sourceUrl]
    ]);
  });
  listen($('open-terrain'), 'click', () => showScience('terrain'));
  listen($('close-science'), 'click', () => dialog.close());
  listen($('terrain-region-select'), 'change', event => {
    const custom = event.target.value === 'custom';
    $('custom-terrain-form').hidden = !custom;
    $('load-terrain-model').disabled = !event.target.value;
    selectedTerrainPatch = null;
    selectedTerrainSource = null;
    terrainViewer.setModel(null);
    $('reset-terrain-model').disabled = true;
    $('terrain-model-caption').textContent =
      'The model is an elevation mesh. Its vertical relief is exaggerated for visibility; the real elevation values are unchanged.';
    setTerrainModelStatus(event.target.value
      ? custom ? 'Enter a center coordinate to use the coarse global MOLA fallback.' : 'Load the selected regional terrain patch to view it in 3D.'
      : 'Select a preset or custom coordinates to load a regional surface.');
  });
  listen($('load-terrain-model'), 'click', loadTerrainModel);
  listen($('terrain-patch-size'), 'change', () => {
    if (!selectedTerrainPatch) return;
    try { renderTerrainModel(); }
    catch (error) { setTerrainModelStatus(`3D terrain view could not be updated: ${error.message}`, true); }
  });
  listen($('reset-terrain-model'), 'click', () => terrainViewer.reset());
  for (const id of ['mission-search', 'mission-status-filter', 'mission-type-filter', 'mission-decade-filter']) {
    listen($(id), id === 'mission-search' ? 'input' : 'change', renderMissions);
  }
  listen($('close-provenance'), 'click', () => { $('provenance-panel').hidden = true; });
  initializeTerrainRegions();
  renderMissions();

  window.addEventListener('pagehide', event => {
    if (event.persisted || disposed) return;
    disposed = true;
    requests.abortAll();
    cleanups.forEach(cleanup => cleanup());
    terrainViewer?.destroy();
  });
})();
