(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  function showFatal(message) { $('fatal-error').textContent = message; $('fatal-error').hidden = false; }
  if (!window.Cesium) { showFatal('CesiumJS could not load. Check your internet connection and reload.'); return; }
  const C = window.Cesium;
  const MARS = new C.Ellipsoid(3396190.0, 3396190.0, 3376200.0);
  const MEAN_RADIUS_KM = 3389.5;
  const ACCENT = C.Color.fromCssColorString('#ff934f');
  // Georeferenced HiRISE location, Golombek et al. (2020):
  // https://doi.org/10.1029/2020EA001248
  const INSIGHT = { id: 'insight', name: 'Elysium Planitia', mission: 'InSight',
    lat: 4.50238417, lon: 135.62344690,
    description: 'NASA InSight weather station. The telemetry panel contains archived observations made here, not weather at other locations on Mars.' };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASEMAPS = {
    viking: { name: 'USGS Viking Color Mosaic', url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}', credit: 'NASA / JPL / USGS / Esri' },
    mola: { name: 'MOLA Colorized Shaded Relief', url: 'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map', layers: 'MOLA_color', credit: 'NASA / MOLA Science Team / USGS Astrogeology' }
  };
  // Both services use longitude/latitude, not Web Mercator. The Viking
  // cache starts with two 512px-wide tiles spanning the full globe.
  const imageryTilingScheme = new C.GeographicTilingScheme({ ellipsoid: MARS });
  let viewer;
  try {
    viewer = new C.Viewer('cesiumContainer', {
      globe: new C.Globe(MARS), mapProjection: new C.GeographicProjection(MARS),
      terrainProvider: new C.EllipsoidTerrainProvider({ ellipsoid: MARS }),
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
      vrButton: false, animation: false, timeline: false, selectionIndicator: false,
      infoBox: false, sceneMode: C.SceneMode.SCENE3D, scene3DOnly: true,
      // Cesium's catalogue-based star cube follows the camera around Mars.
      // Keep Earth-specific atmosphere, Sun and Moon visuals disabled.
      skyAtmosphere: false, creditContainer: $('cesium-credits'),
      shouldAnimate: false, targetFrameRate: 30
    });
  } catch (error) { console.error(error); showFatal('The Mars renderer could not initialize. Enable WebGL and hardware acceleration, then reload.'); return; }
  viewer.resolutionScale = Math.min(1, 1.5 / (window.devicePixelRatio || 1));
  viewer.scene.backgroundColor = C.Color.fromCssColorString('#020308');
  viewer.scene.globe.baseColor = C.Color.fromCssColorString('#8e4835');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 22000000;
  viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  let disposed = false;
  const cleanups = [];
  function listen(element, type, callback) { element.addEventListener(type, callback); cleanups.push(() => element.removeEventListener(type, callback)); }
  function marsPosition(lon, lat, height = 0) { return C.Cartesian3.fromDegrees(lon, lat, height, MARS); }
  function setStatus(id, message, warning = false) { $(id).textContent = message; $(id).classList.toggle('warning', warning); }
  let activeLayer = null;
  let removeImageryErrorListener = null;
  function switchBasemap(key) {
    const definition = BASEMAPS[key];
    if (!definition) return;
    const options = { url: definition.url, tilingScheme: imageryTilingScheme, minimumLevel: 0, maximumLevel: 7, tileWidth: 512, tileHeight: 512, credit: definition.credit };
    const provider = definition.layers
      ? new C.WebMapServiceImageryProvider({
          ...options, layers: definition.layers, enablePickFeatures: false,
          // WMS 1.1.1 uses longitude/latitude BBOX order. This USGS Mars
          // service advertises EPSG:4326 as its angular request convention;
          // Cesium's actual globe and tiling ellipsoid remain Mars.
          parameters: { service: 'WMS', version: '1.1.1', format: 'image/jpeg', transparent: false, styles: '' },
          srs: 'EPSG:4326'
        })
      : new C.UrlTemplateImageryProvider(options);
    const previousLayer = activeLayer;
    // Keep regional HiRISE overlays above the selected global basemap.
    const nextLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
    removeImageryErrorListener?.();
    activeLayer = nextLayer;
    removeImageryErrorListener = provider.errorEvent.addEventListener(() => {
      if (!disposed && activeLayer === nextLayer) setStatus('map-status', 'Some tiles could not load. Check the tile host or try another layer.', true);
    });
    if (previousLayer) viewer.imageryLayers.remove(previousLayer, true);
    setStatus('map-status', `${definition.name} · Global coverage, including polar regions.`);
  }
  listen($('basemap-select'), 'change', (event) => switchBasemap(event.target.value));
  switchBasemap('viking');
  const sites = [
    { id: 'perseverance', name: 'Jezero Crater', mission: 'Perseverance', lat: 18.38, lon: 77.58, description: "NASA's Perseverance rover explores an ancient lake basin and river delta, examining geology and collecting rock samples." },
    { id: 'curiosity', name: 'Gale Crater', mission: 'Curiosity', lat: -4.58, lon: 137.44, description: "NASA's Curiosity rover investigates the rocks of Gale Crater and Mount Sharp to understand past habitable environments." },
    { id: 'opportunity', name: 'Meridiani Planum', mission: 'Opportunity', lat: -1.95, lon: -35.47, description: "NASA's Opportunity rover studied sedimentary rocks and mineral evidence of past water across Meridiani Planum." },
    { id: 'spirit', name: 'Gusev Crater', mission: 'Spirit', lat: -14.57, lon: 175.47, description: "NASA's Spirit rover explored Gusev Crater and the Columbia Hills, investigating volcanic rocks and evidence of water." },
    { id: 'viking-1', name: 'Chryse Planitia', mission: 'Viking 1', lat: 22.48, lon: -47.97, description: "NASA's Viking 1 lander examined the Martian surface, atmosphere, and soil from Chryse Planitia." },
    { id: 'zhurong', name: 'Utopia Planitia', mission: 'Zhurong', lat: 25.06, lon: 109.92, description: "China's Zhurong rover investigated surface materials, subsurface structure, and the environment of Utopia Planitia." }
  ];
  const siteByEntityId = new Map();
  sites.push(
    { id: 'olympus', name: 'Olympus Mons', mission: 'Shield volcano', category: 'Landmark Overview', lat: 18.65, lon: -133.8,
      description: 'The largest known volcano in the Solar System. Its broad volcanic slopes rise to a summit caldera, while a steep escarpment borders much of its base.',
      facts: [['Base width', 'More than 600 km'], ['Bordering escarpment', 'Up to 6 km high'], ['Explore', 'Use MOLA shaded relief to see the volcanic structure.']],
      source: 'https://science.nasa.gov/photojournal/olympus-mons/' },
    { id: 'valles', name: 'Valles Marineris', mission: 'Canyon system', category: 'Landmark Overview', lat: -13.9, lon: -59.2,
      description: 'A vast network of canyons near the Martian equator, east of Tharsis. Steep walls and exposed layers reveal the structure of the Martian crust across an enormous region.',
      facts: [['Length', 'About 3,870 km'], ['Maximum width', 'About 600 km'], ['Maximum depth', 'About 9.3 km'], ['Explore', 'Use MOLA shaded relief to follow the canyon network.']],
      source: 'https://www.nasa.gov/image-article/valles-marineris-grand-canyon-of-mars/' }
  );
  sites.push(INSIGHT);
  const pulseStart = performance.now();
  sites.forEach((site, index) => {
    const id = `site-${site.id}`;
    viewer.entities.add({ id, name: `${site.name} — ${site.mission}`, position: marsPosition(site.lon, site.lat, 1200), description: `<h2>${site.name}</h2><p><strong>${site.mission}</strong></p><p>${site.description}</p>`,
      point: { pixelSize: reducedMotion ? 11 : new C.CallbackProperty(() => 11 + 2.5 * Math.sin((performance.now() - pulseStart) / 1000 * 2.5 + index * 0.65), false), color: site.id === 'insight' ? C.Color.GOLD : ACCENT, outlineColor: ACCENT.withAlpha(0.3), outlineWidth: 6 },
      label: { text: site.category ? site.name : site.mission, font: '12px Consolas, monospace', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -23), showBackground: true, backgroundColor: C.Color.fromCssColorString('#0b0e14').withAlpha(0.8), backgroundPadding: new C.Cartesian2(7, 5), distanceDisplayCondition: new C.DistanceDisplayCondition(0, 10000000) }
    });
    siteByEntityId.set(id, site);
  });
  function formatCoordinates(point) { return `${C.Math.toDegrees(point.latitude).toFixed(4)}°, ${C.Math.toDegrees(point.longitude).toFixed(4)}°`; }
  function openSitePopup(site) {
    $('site-category').textContent = site.category || 'Surface Mission';
    $('site-title').textContent = site.name; $('site-mission').textContent = site.mission;
    $('site-description').textContent = site.description;
    $('site-facts').replaceChildren();
    for (const [label, value] of site.facts || []) {
      const term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = label; detail.textContent = value;
      $('site-facts').append(term, detail);
    }
    $('site-facts').hidden = !site.facts;
    $('site-source').hidden = !site.source;
    if (site.source) $('site-source').href = site.source;
    else $('site-source').removeAttribute('href');
    $('site-coordinates').textContent = `${site.lat.toFixed(4)}° latitude · ${site.lon.toFixed(4)}° longitude · ${site.category ? 'Overview camera target' : 'Reference site'}`;
    $('site-popup').hidden = false;
    $('site-popup').scrollTop = 0;
  }
  function closeSitePopup() { $('site-popup').hidden = true; }
  listen($('close-popup'), 'click', closeSitePopup);
  function flyToMars(lat, lon, altitude) {
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({ destination: marsPosition(lon, lat, altitude), orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 }, duration: reducedMotion ? 0 : 2.4 });
  }
  [['jump-jezero', 'perseverance', 350000], ['jump-gale', 'curiosity', 350000], ['jump-olympus', 'olympus', 500000], ['jump-valles', 'valles', 800000], ['jump-insight', 'insight', 200000]].forEach(([id, siteId, altitude]) => listen($(id), 'click', () => {
    const site = sites.find(item => item.id === siteId);
    flyToMars(site.lat, site.lon, altitude);
    openSitePopup(site);
    inspectLocation(C.Cartographic.fromDegrees(site.lon, site.lat), site);
  }));
  viewer.camera.setView({ destination: marsPosition(50, 15, 9500000), orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 } });
  // Bounds, matrix identifiers and maximum levels verified against each
  // NASA Mars Trek WMTS capabilities document. These are regional mosaics,
  // not global HiRISE coverage. No full-resolution mosaic download needed.
  const HIRISE_SITES = {
    gale: {
      name: 'Gale Crater · Curiosity', product: 'curiosity_hirise_mosaic',
      bounds: [137.1224669, -4.9254743, 137.7298129, -4.2489588],
      longitude: 137.44, latitude: -4.58, maximumLevel: 16
    },
    spirit: {
      name: 'Gusev Crater · Spirit', product: 'spirit_hirise_mosaic',
      bounds: [175.4278511, -14.6925026, 175.5858031, -14.5357546],
      longitude: 175.5, latitude: -14.6, maximumLevel: 17
    },
    opportunity: {
      name: 'Meridiani Planum · Opportunity', product: 'opportunity_hirise_mosaic',
      bounds: [-5.5964391, -2.7513281, -4.9954112, -1.8994384],
      longitude: -5.3, latitude: -2.3, maximumLevel: 17
    }
  };
  let hiriseLayer = null;
  let removeHiriseErrorListener = null;
  let selectedHirise = null;
  function flyToHirise() {
    if (selectedHirise) flyToMars(selectedHirise.latitude, selectedHirise.longitude, 9000);
  }
  function selectHirise(key) {
    removeHiriseErrorListener?.();
    removeHiriseErrorListener = null;
    if (hiriseLayer) viewer.imageryLayers.remove(hiriseLayer, true);
    hiriseLayer = null;
    selectedHirise = HIRISE_SITES[key] || null;
    $('hirise-controls').hidden = !selectedHirise;
    if (!selectedHirise) {
      setStatus('hirise-status', 'HiRISE off. The global basemap remains visible.');
      return;
    }
    const site = selectedHirise;
    const provider = new C.UrlTemplateImageryProvider({
      url: `https://trek.nasa.gov/tiles/Mars/EQ/${site.product}/1.0.0/default/default028mm/{z}/{y}/{x}.png`,
      tilingScheme: imageryTilingScheme,
      rectangle: C.Rectangle.fromDegrees(...site.bounds),
      tileWidth: 256, tileHeight: 256, minimumLevel: 0,
      maximumLevel: site.maximumLevel, hasAlphaChannel: true,
      credit: 'HiRISE: NASA / JPL-Caltech / University of Arizona · NASA Mars Trek'
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    hiriseLayer = layer;
    layer.alpha = Number($('hirise-opacity').value) / 100;
    removeHiriseErrorListener = provider.errorEvent.addEventListener(() => {
      if (!disposed && hiriseLayer === layer) {
        setStatus('hirise-status', 'Some HiRISE tiles are unavailable. Switch off the overlay to view the basemap, or reselect this site to retry.', true);
      }
    });
    $('hirise-source').href = `https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label=${site.product}`;
    setStatus('hirise-status', `${site.name} · HiRISE enabled. Zoom in to explore the surface.`);
    closeSitePopup();
    flyToHirise();
  }
  listen($('hirise-select'), 'change', (event) => selectHirise(event.target.value));
  listen($('hirise-fly'), 'click', flyToHirise);
  listen($('hirise-opacity'), 'input', (event) => {
    const opacity = Number(event.target.value);
    $('hirise-opacity-value').textContent = `${opacity}%`;
    if (hiriseLayer) hiriseLayer.alpha = opacity / 100;
  });
  let profilerEnabled = false;
  let measuredPoints = [];
  const measurementEntities = [];
  const defaultMeasurementNote = 'Imagery only: terrain elevations and slope are unavailable. Surface measurements exclude terrain relief.';
  function clearMeasurement() {
    measurementEntities.forEach((entity) => viewer.entities.remove(entity));
    measurementEntities.length = 0; measuredPoints = [];
    ['surface-distance', 'geodesic-distance', 'chord-distance', 'point-a', 'point-b'].forEach((id) => { $(id).textContent = '—'; });
    $('measurement-note').textContent = defaultMeasurementNote;
    $('profiler-instructions').textContent = profilerEnabled ? 'Select Point A on the globe. Escape exits the profiler.' : 'Enable the profiler, then select two points on Mars.';
  }
  function setProfiler(enabled) {
    profilerEnabled = enabled;
    $('profiler-btn').classList.toggle('active', enabled);
    $('profiler-btn').setAttribute('aria-pressed', String(enabled));
    $('cesiumContainer').classList.toggle('profiler-active', enabled);
    if (enabled) { closeSitePopup(); clearMeasurement(); }
    else $('profiler-instructions').textContent = 'Profiler off. Enable it to start another measurement.';
  }
  listen($('profiler-btn'), 'click', () => setProfiler(!profilerEnabled));
  listen($('clear-profiler'), 'click', clearMeasurement);
  listen(document, 'keydown', (event) => { if (event.key === 'Escape') { if (profilerEnabled) setProfiler(false); closeSitePopup(); } });
  function addMeasurementMarker(point, label) {
    const height = Math.max(1000, MARS.cartesianToCartographic(viewer.camera.positionWC).height);
    const radius = C.Math.clamp(height * 0.0025, 150, 9000);
    measurementEntities.push(viewer.entities.add({ name: `Measurement Point ${label}`, position: MARS.cartographicToCartesian(new C.Cartographic(point.longitude, point.latitude, radius)),
      ellipsoid: { radii: new C.Cartesian3(radius, radius, radius), material: ACCENT.withAlpha(0.8), outline: true, outlineColor: C.Color.WHITE, stackPartitions: 16, slicePartitions: 16 },
      point: { pixelSize: 10, color: ACCENT, outlineColor: ACCENT.withAlpha(0.3), outlineWidth: 7 },
      label: { text: label, font: 'bold 16px Consolas, monospace', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -25) }
    }));
  }
  function centralAngle(a, b) {
    const h = C.Math.clamp(Math.sin((b.latitude - a.latitude) / 2) ** 2 + Math.cos(a.latitude) * Math.cos(b.latitude) * Math.sin((b.longitude - a.longitude) / 2) ** 2, 0, 1);
    return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function unitVector(point) { const c = Math.cos(point.latitude); return new C.Cartesian3(c * Math.cos(point.longitude), c * Math.sin(point.longitude), Math.sin(point.latitude)); }
  function sphericalInterpolator(a, b) {
    const start = unitVector(a), end = unitVector(b);
    const dot = C.Math.clamp(C.Cartesian3.dot(start, end), -1, 1);
    const tangent = C.Cartesian3.subtract(end, C.Cartesian3.multiplyByScalar(start, dot, new C.Cartesian3()), new C.Cartesian3());
    const length = C.Cartesian3.magnitude(tangent), angle = Math.atan2(length, dot);
    if (length < 1e-12) {
      if (dot > 0) return () => C.Cartographic.clone(a);
      C.Cartesian3.cross(Math.abs(start.z) < 0.9 ? C.Cartesian3.UNIT_Z : C.Cartesian3.UNIT_X, start, tangent);
    }
    C.Cartesian3.normalize(tangent, tangent);
    return (fraction) => {
      if (fraction === 0) return C.Cartographic.clone(a);
      if (fraction === 1) return C.Cartographic.clone(b);
      const theta = angle * fraction;
      const vector = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(start, Math.cos(theta), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(tangent, Math.sin(theta), new C.Cartesian3()), new C.Cartesian3());
      return new C.Cartographic(Math.atan2(vector.y, vector.x), Math.atan2(vector.z, Math.hypot(vector.x, vector.y)), 0);
    };
  }
  function calculateMeasurement() {
    const [a, b] = measuredPoints;
    const angle = centralAngle(a, b);
    const chord = C.Cartesian3.distance(MARS.cartographicToCartesian(a), MARS.cartographicToCartesian(b)) / 1000;
    let distance = null, interpolate = sphericalInterpolator(a, b), fallback = false;
    if (angle < 1e-12) distance = 0;
    else if (Math.PI - angle < 0.02) fallback = true;
    else {
      try {
        const geodesic = new C.EllipsoidGeodesic(a, b, MARS);
        if (!Number.isFinite(geodesic.surfaceDistance)) throw new Error('Non-finite geodesic.');
        distance = geodesic.surfaceDistance / 1000;
        interpolate = (fraction) => geodesic.interpolateUsingFraction(fraction, new C.Cartographic());
      } catch (error) { console.warn('Using spherical path fallback:', error); fallback = true; }
    }
    // Pre-sample against Mars; ArcType.NONE avoids Earth-based subdivision.
    const segments = Math.max(1, Math.ceil(angle / 0.002)), positions = [];
    for (let i = 0; i <= segments; i++) {
      const point = interpolate(i / segments);
      positions.push(MARS.cartographicToCartesian(new C.Cartographic(point.longitude, point.latitude, 80)));
    }
    if (angle >= 1e-12) measurementEntities.push(viewer.entities.add({ name: 'Mars surface measurement path', polyline: { positions, width: 5, arcType: C.ArcType.NONE, clampToGround: false, material: new C.PolylineGlowMaterialProperty({ glowPower: 0.25, color: ACCENT }) } }));
    $('surface-distance').textContent = `${(MEAN_RADIUS_KM * angle).toFixed(3)} km`;
    $('geodesic-distance').textContent = distance === null ? 'Unavailable near antipodes' : `${distance.toFixed(3)} km`;
    $('chord-distance').textContent = `${chord.toFixed(3)} km`;
    $('point-a').textContent = formatCoordinates(a); $('point-b').textContent = formatCoordinates(b);
    $('measurement-note').textContent = defaultMeasurementNote + (fallback ? ' A spherical great-circle fallback is drawn for this pair; no ellipsoid geodesic length is reported.' : '');
    $('profiler-instructions').textContent = 'Measurement complete. Select another point to start a new pair.';
  }
  function handleProfilerClick(position) {
    const hit = viewer.camera.pickEllipsoid(position, MARS);
    if (!C.defined(hit)) return;
    const point = MARS.cartesianToCartographic(hit); point.height = 0;
    if (measuredPoints.length === 2) clearMeasurement();
    measuredPoints.push(C.Cartographic.clone(point));
    const label = measuredPoints.length === 1 ? 'A' : 'B'; addMeasurementMarker(point, label);
    if (label === 'A') { $('point-a').textContent = formatCoordinates(point); $('profiler-instructions').textContent = 'Point A selected. Select Point B on the globe.'; }
    else calculateMeasurement();
  }
  const stationCoordinates = C.Cartographic.fromDegrees(INSIGHT.lon, INSIGHT.lat);
  let selectedLocationMarker = null;
  function inspectLocation(point, site = null) {
    const distanceKm = centralAngle(point, stationCoordinates) * MEAN_RADIUS_KM;
    const isStation = site?.id === INSIGHT.id;
    $('location-name').textContent = site ? `${site.name} · ${site.mission}` : 'Selected surface point';
    $('selected-lat').textContent = `${C.Math.toDegrees(point.latitude).toFixed(4)}°`;
    $('selected-lon').textContent = `${C.Math.toDegrees(point.longitude).toFixed(4)}°`;
    $('station-distance').textContent = `${distanceKm.toFixed(1)} km`;
    $('weather-heading').textContent = isStation ? 'InSight · Observed at This Station' : 'InSight Station · Reference Only';
    setStatus('location-weather', isStation
      ? 'Archived measurements for this station are shown below. They are sol averages, not instantaneous readings.'
      : 'No measured temperature or pressure for this point is loaded. InSight is the only weather station in this project; its readings below do not describe this location.');
    if (selectedLocationMarker) viewer.entities.remove(selectedLocationMarker);
    selectedLocationMarker = viewer.entities.add({
      name: 'Inspected location',
      position: MARS.cartographicToCartesian(new C.Cartographic(point.longitude, point.latitude, 50)),
      point: { pixelSize: 9, color: C.Color.GOLD, outlineColor: C.Color.BLACK, outlineWidth: 2 }
    });
    $('telemetry-bar').scrollTop = 0;
  }
  function clearLocation() {
    if (selectedLocationMarker) viewer.entities.remove(selectedLocationMarker);
    selectedLocationMarker = null;
    $('location-name').textContent = 'Click anywhere on Mars to inspect a location.';
    ['selected-lat', 'selected-lon', 'station-distance'].forEach(id => { $(id).textContent = '—'; });
    $('weather-heading').textContent = 'InSight Station · Reference';
    setStatus('location-weather', 'Weather observations are available only at the InSight station in this project.');
  }
  listen($('clear-location'), 'click', clearLocation);
  listen($('inspect-insight'), 'click', () => {
    if (profilerEnabled) setProfiler(false);
    inspectLocation(stationCoordinates, INSIGHT);
    closeSitePopup();
    flyToMars(INSIGHT.lat, INSIGHT.lon, 200000);
  });
  const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  let lastPointerPosition = null, telemetryFrame = null;
  function updateTelemetry() {
    telemetryFrame = null; if (disposed) return;
    $('camera-alt').textContent = `${(MARS.cartesianToCartographic(viewer.camera.positionWC).height / 1000).toFixed(1)} km`;
    const hit = lastPointerPosition ? viewer.camera.pickEllipsoid(lastPointerPosition, MARS) : null;
    if (!C.defined(hit)) { $('cursor-lat').textContent = '—'; $('cursor-lon').textContent = '—'; return; }
    const point = MARS.cartesianToCartographic(hit);
    $('cursor-lat').textContent = `${C.Math.toDegrees(point.latitude).toFixed(4)}°`;
    $('cursor-lon').textContent = `${C.Math.toDegrees(point.longitude).toFixed(4)}°`;
  }
  function scheduleTelemetry() { if (telemetryFrame === null && !disposed) telemetryFrame = requestAnimationFrame(updateTelemetry); }
  handler.setInputAction((movement) => { lastPointerPosition = C.Cartesian2.clone(movement.endPosition); scheduleTelemetry(); }, C.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((movement) => {
    if (profilerEnabled) { handleProfilerClick(movement.position); return; }
    const picked = viewer.scene.pick(movement.position), site = picked?.id?.id ? siteByEntityId.get(picked.id.id) : null;
    if (site) {
      openSitePopup(site);
      inspectLocation(C.Cartographic.fromDegrees(site.lon, site.lat), site);
    } else {
      closeSitePopup();
      const hit = viewer.camera.pickEllipsoid(movement.position, MARS);
      if (C.defined(hit)) inspectLocation(MARS.cartesianToCartographic(hit));
    }
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  listen(viewer.scene.canvas, 'mouseleave', () => { lastPointerPosition = null; scheduleTelemetry(); });
  viewer.camera.percentageChanged = 0.001;
  const removeCameraListener = viewer.camera.changed.addEventListener(scheduleTelemetry);
  updateTelemetry();
  let weatherController = null, weatherInFlight = false;
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
    for (const sol of [...keys].filter((key) => /^\d+$/.test(String(key))).sort((a, b) => Number(b) - Number(a))) {
      const record = data[sol], quality = data.validity_checks?.[sol];
      if (quality?.AT?.valid !== true || quality?.PRE?.valid !== true) continue;
      const observation = { sol: String(sol), temperature: record?.AT?.av,
        pressure: record?.PRE?.av, firstUTC: record?.First_UTC, lastUTC: record?.Last_UTC };
      if (validWeather(observation)) return observation;
    }
    throw new Error('NASA returned no complete, validated weather record.');
  }
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
    if (disposed || weatherInFlight || Date.now() - lastWeatherCheck < WEATHER_CHECK_INTERVAL) return;
    lastWeatherCheck = Date.now();
    try { localStorage.setItem(WEATHER_CHECK_KEY, String(lastWeatherCheck)); } catch (error) { /* Optional cache. */ }
    weatherInFlight = true; weatherController = new AbortController();
    const timeout = window.setTimeout(() => weatherController?.abort(), 10000);
    try {
      const response = await fetch(WEATHER_URL, { signal: weatherController.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`NASA API returned HTTP ${response.status}`);
      const observation = selectNasaWeather(await response.json());
      if (disposed) return;
      if (newerWeather(observation, currentWeather)) {
        currentWeather = observation;
        try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(currentWeather)); } catch (error) { /* Optional cache. */ }
        renderWeather('Verified NASA archive · Latest valid record returned by the API.');
      } else renderWeather('Verified NASA archive · Retaining the newer saved observation.');
    } catch (error) {
      if (disposed) return;
      renderWeather('Verified NASA archive · Saved observations; API refresh unavailable.');
    } finally { window.clearTimeout(timeout); weatherController = null; weatherInFlight = false; }
  }
  loadWeather();
  const weatherRefresh = window.setInterval(() => { if (!document.hidden) loadWeather(); }, 30 * 60 * 1000);
  function dispose() {
    if (disposed) return; disposed = true;
    window.clearInterval(weatherRefresh); weatherController?.abort();
    if (telemetryFrame !== null) cancelAnimationFrame(telemetryFrame);
    cleanups.forEach((cleanup) => cleanup()); removeCameraListener(); removeImageryErrorListener?.(); removeHiriseErrorListener?.();
    if (!handler.isDestroyed()) handler.destroy();
    if (!viewer.isDestroyed()) viewer.destroy();
  }
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
})();
