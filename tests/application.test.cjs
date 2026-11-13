const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildPreview } = require('../scripts/build-preview.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('generated preview embeds current sources in dependency order and parses', () => {
  const preview = buildPreview();
  const scripts = [...preview.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
  assert.equal(scripts.length, 14);
  ['panel-layout.js', 'data-services.js', 'science-data.js', 'terrain-model.js', 'weather.js', 'app.js',
    'marswalk-planner.js', 'marswalk-navigation.js', 'marswalk-terrain.js', 'marswalk.js', 'science-explorer.js', 'solar-system.js',
    'media-library.js', 'dsn-now.js'].forEach((file, i) => {
    assert.ok(scripts[i].includes(read(file)));
    new vm.Script(scripts[i]);
  });
  assert.ok(preview.includes(read('style.css')));
});
test('all literal UI references resolve and IDs are unique', () => {
  const ids = [...read('index.html').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const file of ['app.js', 'marswalk.js', 'science-explorer.js', 'weather.js', 'solar-system.js', 'media-library.js', 'dsn-now.js']) {
    for (const match of read(file).matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), match[1]);
  }
});
test('mission history and terrain explorer have separate launch buttons', () => {
  const html = read('index.html');
  assert.match(html, /id="open-missions"[^>]*>Mission History/);
  assert.match(html, /id="open-terrain"[^>]*>Terrain Explorer/);
  assert.doesNotMatch(html, /Mission History &amp; Terrain Explorer/);
  assert.doesNotMatch(html, /role="tablist"|id="timeline-tab"|id="terrain-tab"/);
  const explorer = read('science-explorer.js');
  assert.match(explorer, /listen\(\$\('open-missions'\), 'click', \(\) => showScience\('timeline'\)\)/);
  assert.match(explorer, /listen\(\$\('open-terrain'\), 'click', \(\) => showScience\('terrain'\)\)/);
  assert.match(explorer, /dialog\.scrollTop = 0/);
  assert.match(explorer, /\$\('science-heading'\)\.textContent = view === 'terrain' \? 'Terrain Explorer' : 'Mission History'/);
  assert.match(explorer, /function activateView\(name\)/);
  assert.doesNotMatch(explorer, /listen\(\$\('timeline-tab'\)|listen\(\$\('terrain-tab'\)/);
});
test('MarsWalk is an independent local scene backed by bounded regional MOLA geometry', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const planner = read('marswalk-planner.js');
  assert.match(html, /id="open-marswalk"[^>]*aria-controls="marswalk-workspace"/);
  assert.match(html, /<aside id="marswalk-workspace"/);
  assert.match(feature, /setMarsWalkSelectionHandler/);
  assert.match(feature, /scene\.globe\.show = false/);
  assert.match(feature, /localCartesian/);
  assert.match(feature, /regionalTerrain\.localPosition/);
  assert.match(feature, /requestAnimationFrame\(tick\)/);
  assert.match(feature, /setCameraAtProgress/);
  assert.match(planner, /science\.sampleElevation/);
  assert.match(planner, /selected DEM coverage/);
  assert.match(planner, /maximumHeight|maximumFlightElevationM/);
  assert.match(planner, /obstacleWeight/);
  assert.doesNotMatch(feature, /showScience\(|open-terrain/);
});
test('selecting a DEM coverage loads and frames its own numerical terrain automatically', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const terrain = read('marswalk-terrain.js');
  const planner = read('marswalk-planner.js');
  assert.match(html, /id="marswalk-region"/);
  assert.match(feature, /listen\(\$\('marswalk-region'\), 'change', \(\) => \{[\s\S]*?loadCoverageTerrain\(selectedRegion\(\)\)/);
  assert.match(feature, /getRegionalTerrain\(region, datumGrid\)/);
  assert.match(feature, /showLocalTerrain\(terrain, surface\.surfaceCanvas\);[\s\S]*?routeScene\.resetView\(\)/);
  assert.match(feature, /thisCoverageRequest !== coverageRequestId/);
  assert.match(feature, /pickTerrainPosition\(event\.position\)/);
  assert.match(terrain, /function getCoverageBounds\(region, science\)/);
  assert.match(planner, /selected DEM coverage/);
});
test('MarsWalk display controls retain one indexed DEM mesh and expose terrain inspection', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const terrain = read('marswalk-terrain.js');
  for (const id of [
    'marswalk-display-mode', 'marswalk-wireframe', 'marswalk-reset-view',
    'marswalk-mesh-info', 'marswalk-inspect-elevation', 'marswalk-inspect-local-height'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(feature, /const mesh = sharedMesh \|\| terrain\.buildMesh\(false\)/);
  assert.match(feature, /indices: mesh\.indices/);
  assert.match(feature, /setSurfaceTexture\(surfaceCanvas\)[\s\S]*appearance\.material =/);
  assert.match(feature, /setWireframe\(enabled\)[\s\S]*wireframePrimitive\.show/);
  assert.match(feature, /pickTerrainPosition\(screenPosition\)/);
  assert.match(terrain, /meshSampleDeltaM/);
});
test('MarsWalk Terrain Explorer style shares the existing elevation renderer without replacing geometry', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const model = read('terrain-model.js');
  assert.match(html, /name="marswalk-surface-style" value="terrain-explorer" checked/);
  assert.match(html, /name="marswalk-surface-style" value="imagery"/);
  assert.match(html, /name="marswalk-surface-style" value="elevation"/);
  assert.match(html, /<option value="terrain-explorer" selected>Terrain Explorer<\/option>[\s\S]*?<option value="imagery">MOLA\/THEMIS<\/option>[\s\S]*?<option value="elevation">Elevation Only<\/option>/);
  assert.match(feature, /let displayMode = 'terrain-explorer'/);
  assert.match(feature, /displayMode = 'terrain-explorer';[\s\S]*?syncSurfaceStyleControl\(displayMode\)/);
  assert.match(feature, /for \(const input of document\.querySelectorAll\('input\[name="marswalk-surface-style"\]'\)\)/);
  assert.match(feature, /let requestedDisplayMode = \$\('marswalk-display-mode'\)\.value/);
  assert.match(feature, /terrainModel\.createExplorerTexture\(/);
  assert.match(model, /function createExplorerTexture\(patch, extentKm/);
  assert.match(model, /context\.strokeStyle = 'rgba\(13, 15, 18, \.16\)'/);
  assert.match(feature, /setSurfaceTexture\(surface\.surfaceCanvas\)/);
  assert.match(feature, /previous \$\{displayModeName\(displayMode\)\} appearance is still active/);
  assert.match(feature, /current appearance remains visible/);
  const textureSetter = feature.match(/setSurfaceTexture\(surfaceCanvas\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(textureSetter);
  assert.match(textureSetter, /appearance\.material =/);
  assert.doesNotMatch(textureSetter, /clear\(|showTerrain\(|setView\(|resetView\(/);
});
test('MarsWalk menu groups its workflow and keeps advanced information collapsed', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const menu = html.slice(html.indexOf('<aside id="marswalk-workspace"'), html.indexOf('</aside>', html.indexOf('<aside id="marswalk-workspace"')));
  const sectionOrder = ['marswalk-terrain-title', 'marswalk-points-title', 'marswalk-display-title',
    'marswalk-mode-title', 'marswalk-controls-title'].map(id => menu.indexOf(id));
  assert.ok(sectionOrder.every((position, index) => position >= 0 && (!index || position > sectionOrder[index - 1])));
  assert.match(menu, /<summary>Manual coordinates<\/summary>/);
  assert.match(menu, /id="marswalk-advanced-settings" class="marswalk-disclosure"/);
  assert.match(menu, /<summary>Route details<\/summary>/);
  assert.match(menu, /id="marswalk-inspection-details" class="marswalk-disclosure"/);
  assert.match(menu, /id="marswalk-play"[^>]*>Start Journey<\/button>/);
  assert.doesNotMatch(menu, /id="marswalk-(pause|restart|stop)"/);
  assert.match(feature, /function updateEndpointSummary\(\)/);
  assert.match(feature, /function updateJourneyControls\(\)/);
  assert.match(feature, /function applyFlightProfile\(mode, updateValues = true\)/);
  assert.match(feature, /function markCustomProfileStale\(\)/);
  assert.match(feature, /function loadPreset\(\)[\s\S]*?loadCoverageTerrain\(selectedRegion\(\)\)/);
  assert.match(feature, /function open\(\)[\s\S]*?displayMode = 'terrain-explorer'/);
});
test('MarsWalk four cameras share one flight clock and replace the menu only while playing', () => {
  const html = read('index.html');
  const styles = read('style.css');
  const feature = read('marswalk.js');
  assert.match(html, /marswalk-camera-hud/);
  assert.match(html, /marswalk-cinematic-label[^>]*>CINEMATIC VIEW/);
  assert.match(html, /marswalk-pilot-frame/);
  assert.match(html, /marswalk-camera-label">PILOT VIEW/);
  assert.match(html, /id="marswalk-top-canvas"/);
  assert.match(html, /id="marswalk-side-canvas"/);
  assert.match(html, /id="marswalk-flight-controls"/);
  assert.match(html, /TOP VIEW/);
  assert.match(html, /SIDE VIEW/);
  assert.match(styles, /#marswalk-pilot-frame/);
  assert.match(styles, /body\.marswalk-flight-active #marswalk-workspace/);
  assert.match(styles, /body\.marswalk-flight-active #marswalk-auxiliary-views/);
  assert.match(styles, /grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(feature, /function ensurePilotView\(\)/);
  assert.match(feature, /function createSecondaryViewer\(container\)/);
  assert.match(feature, /secondary\.useDefaultRenderLoop = false/);
  assert.match(feature, /pilotScene\?\.updateProgress\(progress, plan\.trajectory, cameraDeltaSeconds, cameraSnap\)/);
  assert.match(feature, /view\.scene\.updateProgress\(progress, plan\.trajectory, cameraDeltaSeconds, cameraSnap, view\.mode\)/);
  assert.match(feature, /ensureAuxiliaryView\('top'\)/);
  assert.match(feature, /ensureAuxiliaryView\('side'\)/);
  assert.match(feature, /updateAuxiliaryCamera\(mode, progress, route, sample, deltaSeconds, snap\) \{/);
  assert.match(feature, /new C\.Cartesian3\(0, 0, -1\)/);
  assert.match(feature, /function setFlightInterface\(active, hidePilot = false\)/);
  assert.match(feature, /setFlightInterface\(false, true\)/);
  assert.match(feature, /listen\(\$\('marswalk-flight-pause'\), 'click', \(\) => \{/);
  assert.match(feature, /listen\(\$\('marswalk-flight-restart'\), 'click', restart\)/);
  assert.match(feature, /listen\(\$\('marswalk-flight-stop'\), 'click', stop\)/);
  assert.match(feature, /routeScene\.setCameraPose\(position, lookDirection/);
  assert.match(feature, /accelerationMagnitude > 60000/);
  assert.match(feature, /speed > 24000/);
  assert.match(feature, /0\.8 \* deltaSeconds/);
  assert.match(feature, /function tick\(now\)/);
  assert.equal((feature.match(/requestAnimationFrame\(tick\)/g) || []).length, 2);
});
test('MarsWalk navigation is bounded to the active patch and disables competing Cesium controls', () => {
  const feature = read('marswalk.js');
  const html = read('index.html');
  assert.match(html, /marswalk-navigation\.js/);
  assert.match(feature, /screenSpaceCameraController;\s*const canvas = this\.viewer\.scene\.canvas/);
  assert.match(feature, /controller\.enableInputs = false/);
  assert.match(feature, /classifyWheel\(event, canvas\.clientHeight\)/);
  assert.match(feature, /gesturechange/);
  assert.match(feature, /pointerDistance\(\)/);
  assert.match(feature, /orbitNavigation\(dx, dy\)/);
  assert.match(feature, /navigation\.panOffset\(/);
  assert.match(feature, /contextmenu/);
  assert.match(feature, /zoomDistance\(/);
  assert.match(feature, /this\.terrain\.region\.halfExtentKm \* 1000/);
  assert.match(feature, /function releaseCameraControl\(\)[\s\S]*?syncNavigationFromCamera/);
  assert.match(feature, /resetView\(\) \{[\s\S]*?resetNavigationView\(target, destination\)/);
});
test('MarsWalk endpoint markers use the selected regional DEM and update through the shared scene', () => {
  const feature = read('marswalk.js');
  assert.match(feature, /function updateEndpointMarkers\(\)[\s\S]*?regionalTerrain\.sample\(point\)/);
  assert.match(feature, /setEndpointMarkers\(points\.start, points\.destination\)/);
  assert.match(feature, /position: this\.localCartesian\(point, 3\)/);
  assert.match(feature, /label:\s*\{\s*text: label/);
  assert.match(feature, /listen\(\$\('marswalk-swap'\), 'click', \(\) => \{[\s\S]*?updateEndpointSummary\(\)/);
  assert.match(feature, /listen\(\$\('marswalk-clear'\), 'click', \(\) => \{[\s\S]*?updateEndpointSummary\(\)/);
  assert.match(feature, /pilotScene\?\.setEndpointMarkers\(points\.start, points\.destination\)/);
});
test('MarsWalk toolbar playback rate updates the shared route clock', () => {
  const html = read('index.html');
  const feature = read('marswalk.js');
  const navigation = read('marswalk-navigation.js');
  for (const speed of ['0.5', '1', '2', '4', '8']) {
    assert.match(html, new RegExp(`<option value="${speed}"`));
  }
  assert.match(feature, /listen\(\$\('marswalk-flight-speed'\), 'change', \(\) => setPlaybackSpeed/);
  assert.match(feature, /navigation\.advanceProgress\(progress, elapsedSeconds, playbackSpeed, plan\.durationSeconds\)/);
  assert.match(navigation, /const SPEED_OPTIONS = Object\.freeze\(\[0\.5, 1, 2, 4, 8\]\)/);
});
test('Terrain Explorer retains the 3D regional surface and removes following profile and route UI', () => {
  const html = read('index.html');
  const explorer = read('science-explorer.js');
  const terrainView = html.slice(html.indexOf('<section id="terrain-view"'), html.indexOf('</section>\n  </dialog>', html.indexOf('<section id="terrain-view"')));
  assert.match(terrainView, /Interactive 3D regional surface/);
  assert.match(terrainView, /id="terrain-model-canvas"/);
  for (const id of ['elevation-profile', 'analyze-route', 'draw-route', 'route-file',
    'route-waypoints', 'terrain-summary', 'provenance-panel']) {
    assert.doesNotMatch(terrainView, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(explorer, /function (analyzeRoute|renderProfile|exportProfile|setDrawing|addWaypoint)\(/);
  assert.doesNotMatch(explorer, /listen\(\$\('(analyze-route|draw-route|route-file|load-terrain)'/);
  assert.match(explorer, /terrainModel\.attachViewer\(\$\('terrain-model-canvas'\)\)/);
  assert.match(explorer, /terrainModel\.buildMesh\(/);
});
test('Opportunity reference and honest feature labels remain consistent', () => {
  const source = read('app.js');
  assert.match(source, /id: 'opportunity'.*lat: -1\.95, lon: -5\.53/);
  for (const file of ['app.js', 'weather.js', 'index.html', 'README.md', 'HIRISE.md']) {
    assert.doesNotMatch(read(file), /-35\.47|Realtime Weather|only weather station|Terrain &amp; Distance Profiler/);
  }
});
test('solar model rejects unsupported dates and keeps physically plausible orbit distances', () => {
  const source = read('solar-system.js');
  const context = { window: {}, document: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('  const canvas=')) + '})();', context);
  const model = context.window.MarsSolarModel;
  for (const date of ['1800-01-01', '2000-01-01', '2026-10-04', '2049-12-31']) {
    const bodies = model.positionsAt(Date.parse(date));
    assert.equal(bodies.length, 8);
    assert.ok(bodies.every(body => body.position.every(Number.isFinite)));
    const earth = model.distanceAU(bodies[2].position), mars = model.distanceAU(bodies[3].position);
    assert.ok(earth > 0.98 && earth < 1.02);
    assert.ok(mars > 1.37 && mars < 1.68);
  }
  for (const date of ['1799-12-31', '2050-01-01']) assert.throws(() => model.positionsAt(Date.parse(date)));
});
