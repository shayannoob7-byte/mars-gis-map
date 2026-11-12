const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const science = require('../science-data.js');
const terrainModel = require('../terrain-model.js');
const marswalkTerrain = require('../marswalk-terrain.js');
const planner = require('../marswalk-planner.js');

const dataRoot = path.join(__dirname, '..', 'data');

function regionalGrid() {
  return science.decodeMola(
    fs.readFileSync(path.join(dataRoot, 'mola-meg004-topography.img')),
    fs.readFileSync(path.join(dataRoot, 'mola-meg004-areoid-radius-offset.img'))
  );
}

function gradientPatch() {
  const elevations = new Int16Array(terrainModel.SIZE * terrainModel.SIZE);
  for (let row = 0; row < terrainModel.SIZE; row++) {
    for (let column = 0; column < terrainModel.SIZE; column++) {
      elevations[row * terrainModel.SIZE + column] = -1200 + row * 8 + column * 3;
    }
  }
  return {
    size: terrainModel.SIZE,
    elevations,
    halfExtentKm: terrainModel.HALF_EXTENT_KM,
    resolutionMeters: 463
  };
}

function testRegion() {
  return {
    ...terrainModel.REGIONS[0],
    latitude: 18.4447,
    longitude: 77.4508,
    halfExtentKm: 59,
    resolutionMeters: 463
  };
}

test('coverage bounds use each regional patch metadata and wrap longitudes', () => {
  for (const region of terrainModel.REGIONS) {
    const coverage = marswalkTerrain.getCoverageBounds(region, science);
    assert.equal(coverage.id, region.id);
    assert.equal(coverage.name, region.name);
    assert.equal(coverage.dataFile, region.file);
    assert.equal(coverage.sourceProduct, region.sourceProduct);
    assert.equal(coverage.centerLatitude, region.latitude);
    assert.equal(coverage.centerLongitude, ((region.longitude + 180) % 360 + 360) % 360 - 180);
    assert.equal(coverage.widthKm, region.halfExtentKm * 2);
    assert.equal(coverage.patchSize, region.patchSize);
    assert.equal(coverage.resolutionMetersAtEquator, region.resolutionMeters);
    assert.ok(coverage.southLatitude < region.latitude);
    assert.ok(coverage.northLatitude > region.latitude);
    for (const longitude of [coverage.westLongitude, coverage.eastLongitude]) {
      assert.ok(longitude >= -180 && longitude < 180);
    }
  }

  const acrossDateLine = marswalkTerrain.getCoverageBounds({
    ...terrainModel.REGIONS[0], latitude: 0, longitude: 179.5
  }, science);
  assert.ok(acrossDateLine.westLongitude > 170);
  assert.ok(acrossDateLine.eastLongitude < -170);
  assert.throws(() => marswalkTerrain.getCoverageBounds({
    ...terrainModel.REGIONS[0], file: ''
  }, science), /unsupported or incomplete/);
});

test('regional sampler shares mesh elevations and rejects points beyond its patch', () => {
  const terrain = marswalkTerrain.createRegionalTerrain(
    testRegion(), gradientPatch(), regionalGrid(), science
  );
  const center = { latitude: terrain.region.latitude, longitude: terrain.region.longitude };
  const sampled = terrain.sample(center);
  const local = terrain.localPosition(center);
  assert.equal(sampled.valid, true);
  assert.equal(sampled.dataset, terrain.source.id);
  assert.equal(sampled.resolutionMetersAtEquator, 463);
  assert.ok(Math.abs(local.z - sampled.localElevationM) < 1e-8);
  assert.ok(sampled.radialRadiusM > 3_300_000);
  assert.equal(terrain.sample({ latitude: 20, longitude: center.longitude }).valid, false);
  assert.throws(() => terrain.localPosition({ latitude: 20, longitude: center.longitude }), /outside/);
});

test('terrain inspection maps clicked mesh coordinates to the unchanged DEM samples', () => {
  const terrain = marswalkTerrain.createRegionalTerrain(
    testRegion(), gradientPatch(), regionalGrid(), science
  );
  const center = { latitude: terrain.region.latitude, longitude: terrain.region.longitude };
  const position = terrain.localPosition(center);
  const inspection = terrain.inspectLocalPosition(position);
  assert.ok(Math.abs(inspection.latitude - center.latitude) < 1e-8);
  assert.ok(Math.abs(inspection.longitude - center.longitude) < 1e-8);
  assert.ok(Math.abs(inspection.sampleElevationM - terrain.sample(center).elevationM) < 1e-8);
  assert.ok(Math.abs(inspection.localHeightM) < 1e-8);
  assert.ok(Math.abs(inspection.meshElevationM - inspection.sampleElevationM) < 1e-8);
  assert.ok(Math.abs(inspection.meshLocalHeightM - position.z) < 0.1);
  assert.throws(() => terrain.inspectLocalPosition({ x: Infinity, y: 0 }), /Finite local terrain coordinates/);
});

test('route samples use the same piecewise-linear elevations as the rendered mesh', () => {
  const patch = gradientPatch();
  const row = 128;
  const column = 128;
  patch.elevations[row * patch.size + column] = 0;
  patch.elevations[row * patch.size + column + 1] = 100;
  patch.elevations[(row + 1) * patch.size + column] = 200;
  patch.elevations[(row + 1) * patch.size + column + 1] = 0;
  const region = testRegion();
  const terrain = marswalkTerrain.createRegionalTerrain(
    region, patch, regionalGrid(), science
  );
  const centerLatitude = science.planetographicToPlanetocentric(region.latitude);
  const eastM = ((column + 0.25) / (patch.size - 1) - 0.5) * 118000;
  const northM = (0.5 - (row + 0.25) / (patch.size - 1)) * 118000;
  const point = {
    latitude: science.planetocentricToPlanetographic(
      centerLatitude + northM / 3389500 * 180 / Math.PI
    ),
    longitude: region.longitude +
      eastM / (3389500 * Math.cos(centerLatitude * Math.PI / 180)) * 180 / Math.PI
  };
  const sampled = terrain.sample(point);
  const inspection = terrain.inspectLocalPosition(terrain.localPosition(point));
  assert.ok(Math.abs(sampled.elevationM - 75) < 1e-6);
  assert.ok(Math.abs(sampled.elevationM - inspection.meshElevationM) < 1e-9);
  assert.ok(Math.abs(sampled.localElevationM - inspection.meshLocalHeightM) < 1e-9);
  assert.ok(Math.abs(inspection.meshSampleDeltaM) < 1e-9);
});

test('MOLA-THEMIS texture requests are bounded and disclose their nominal image scale', () => {
  const region = terrainModel.REGIONS.find(candidate => candidate.id === 'jezero-perseverance');
  const request = marswalkTerrain.createImageryRequest(region, science);
  assert.ok(request);
  assert.equal(request.resolutionMeters, 100);
  assert.equal(request.patchId, region.id);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('layers'), 'MOLA_THEMIS_blend');
  assert.equal(url.searchParams.get('srs'), 'EPSG:4326');
  assert.equal(url.searchParams.get('width'), '1180');
  assert.equal(url.searchParams.get('height'), '1180');
  assert.equal(url.searchParams.get('format'), 'image/png');
  const bbox = url.searchParams.get('bbox').split(',').map(Number);
  const expectedLatitudeSpan = 2 * region.halfExtentKm * 1000 / 3389500 * 180 / Math.PI;
  assert.ok(Math.abs((bbox[3] - bbox[1]) - expectedLatitudeSpan) < 1e-8);
  assert.ok(bbox[2] - bbox[0] > 2);
  assert.ok(marswalkTerrain.createImageryRequest(
    terrainModel.REGIONS.find(candidate => candidate.id === 'phoenix-landing'), science
  ));
  assert.equal(marswalkTerrain.createImageryRequest({
    ...region, latitude: 89.5, halfExtentKm: 59
  }, science), null);
});

test('blank and transparent image responses are rejected instead of reported as terrain textures', () => {
  const priorDocument = global.document;
  const hadDocument = Object.hasOwn(global, 'document');
  global.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          let sourceImage = null;
          return {
            createImageData(size) {
              return { data: new Uint8ClampedArray(size * size * 4) };
            },
            putImageData() {},
            drawImage(image) {
              sourceImage = image;
            },
            getImageData(_x, _y, width, height) {
              const data = new Uint8ClampedArray(width * height * 4);
              for (let index = 0; index < width * height; index++) {
                if (sourceImage?.kind === 'blank') continue;
                const color = sourceImage?.kind === 'solid' ? 64 : index % 256;
                data.set([color, color, color, 255], index * 4);
              }
              return { data };
            }
          };
        }
      };
    }
  };
  const terrain = { region: {}, patch: { size: 2, elevations: new Int16Array([0, 1, 2, 3]) } };
  try {
    assert.throws(() => marswalkTerrain.createSurfaceTexture(
      terrain, { width: 32, height: 32, kind: 'blank' }
    ), /blank or transparent/);
    assert.throws(() => marswalkTerrain.createSurfaceTexture(
      terrain, { width: 32, height: 32, kind: 'solid' }
    ), /blank or transparent/);
    assert.equal(marswalkTerrain.createSurfaceTexture(
      terrain, { width: 32, height: 32, kind: 'varied' }
    ).width, 32);
  } finally {
    if (hadDocument) global.document = priorDocument;
    else delete global.document;
  }
});

test('regional mesh contains real displaced geometry at the bundled 256-sample spacing', () => {
  const terrain = marswalkTerrain.createRegionalTerrain(
    testRegion(), gradientPatch(), regionalGrid(), science
  );
  const mesh = terrain.buildMesh();
  const explorerPreview = terrainModel.buildMesh(terrain.patch, 118, 3, 128);
  assert.equal(mesh.size, 256);
  assert.equal(explorerPreview.size, 128);
  assert.equal(explorerPreview.exaggeration, 3);
  assert.equal(mesh.widthMeters, 118000);
  assert.equal(mesh.resolutionMetersAtEquator, 463);
  assert.ok(mesh.minimumElevationM < mesh.maximumElevationM);
  for (const [row, column] of [[0, 0], [127, 128], [255, 255]]) {
    const eastM = (column / 255 - 0.5) * 118000;
    const northM = (0.5 - row / 255) * 118000;
    const curvatureM = (eastM ** 2 + northM ** 2) / (2 * 3389500);
    const offset = (row * 256 + column) * 3;
    assert.ok(Math.abs(mesh.positions[offset + 2] -
      (terrain.patch.elevations[row * 256 + column] - curvatureM)) < 1e-9);
  }
  const vertexCount = mesh.bands.reduce((sum, band) => sum + band.values.length / 6, 0);
  assert.equal(vertexCount, 2 * 255 * 255 * 3);
  assert.ok(mesh.bands.every(band => band.values.every(Number.isFinite)));
  const heights = mesh.bands.flatMap(band => {
    const values = [];
    for (let index = 2; index < band.values.length; index += 6) values.push(band.values[index]);
    return values;
  });
  assert.ok(Math.max(...heights.slice(0, 1000)) > Math.min(...heights.slice(0, 1000)));
});

test('regional route flight height follows the same DEM samples used by the local scene', () => {
  const datum = regionalGrid();
  const terrain = marswalkTerrain.createRegionalTerrain(
    testRegion(), gradientPatch(), datum, science
  );
  const regionalScience = {
    ...science,
    sampleElevation: (_grid, latitude, longitude) => terrain.sample({ latitude, longitude })
  };
  const start = { latitude: 18.59, longitude: 77.4508 };
  const destination = { latitude: 18.29, longitude: 77.4508 };
  const result = planner.planRoute(datum, regionalScience, start, destination, {
    mode: 'follow',
    clearanceM: 2200,
    smoothness: 0,
    sampleSpacingKm: 1.5,
    dataset: terrain.source
  });
  assert.equal(result.dataset.id, terrain.source.id);
  assert.equal(result.dataset.resolutionMetersAtEquator, 463);
  assert.ok(result.trajectory.length > 10);
  assert.ok(result.trajectory.every(point => point.terrain.valid && point.clearanceM >= 2200));
  assert.ok(result.trajectory.at(-1).terrain.elevationM > result.trajectory[0].terrain.elevationM + 150);
  for (const point of result.trajectory) {
    assert.ok(Math.abs(point.flightHeightM - point.terrainHeightM - point.clearanceM) < 1e-6);
    const localTerrain = terrain.localPosition(point);
    const localDrone = terrain.localPosition(point, point.clearanceM);
    assert.ok(Math.abs(localDrone.z - localTerrain.z - point.clearanceM) < 1e-8);
  }
  assert.throws(() => planner.planRoute(datum, regionalScience,
    { latitude: 20, longitude: 77.45 }, destination, {
      sampleSpacingKm: 1.5, dataset: terrain.source
    }), /regional terrain sample is unavailable|inside the selected/);
});

test('all curated MarsWalk presets plan entirely within their bundled regional patches', () => {
  const datum = regionalGrid();
  for (const preset of planner.PRESETS) {
    const region = terrainModel.REGIONS.find(candidate => candidate.id === preset.regionId);
    assert.ok(region, `${preset.id} has a bundled regional patch`);
    const patch = terrainModel.decodePatch(fs.readFileSync(path.join(__dirname, '..', region.file)));
    const terrain = marswalkTerrain.createRegionalTerrain(region, patch, datum, science);
    const regionalScience = {
      ...science,
      sampleElevation: (_grid, latitude, longitude) => terrain.sample({ latitude, longitude })
    };
    const result = planner.planRoute(datum, regionalScience, preset.start, preset.destination, {
      mode: preset.mode,
      clearanceM: preset.clearanceM,
      smoothness: 0.2,
      sampleSpacingKm: 1.5,
      dataset: terrain.source
    });
    assert.equal(result.dataset.regionId, preset.regionId);
    assert.ok(result.trajectory.every(point => point.terrain.valid));
    assert.ok(result.minimumClearanceM >= preset.clearanceM);
    assert.ok(result.maximumFlightElevationM < 100000);
  }
});
