const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const science = require('../science-data.js');

const dataRoot = path.join(__dirname, '..', 'data');

function constantRaster(value) {
  const bytes = Buffer.alloc(science.GRID.width * science.GRID.height * 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 2) view.setInt16(offset, value, false);
  return bytes;
}

test('bundled PDS MEGDR rasters decode and provide attributed, bounded elevation samples', () => {
  const grid = science.decodeMola(
    fs.readFileSync(path.join(dataRoot, 'mola-meg004-topography.img')),
    fs.readFileSync(path.join(dataRoot, 'mola-meg004-areoid-radius-offset.img'))
  );
  const sample = science.sampleElevation(grid, 18.4447, 77.4508);
  assert.equal(sample.valid, true);
  assert.equal(sample.dataset, 'mgs-mola-megdr-4ppd-v2');
  assert.equal(sample.datasetVersion, '2.0');
  assert.equal(sample.verticalReference, science.MOLA_SOURCE.verticalReference);
  assert.ok(sample.elevationM >= -8068 && sample.elevationM <= 21134);
  assert.ok(sample.radialRadiusM > 3_300_000 && sample.radialRadiusM < 3_500_000);
  assert.ok(sample.planetocentricLatitude < sample.latitude, 'northern planetographic latitude converts to a lower planetocentric latitude');
  assert.equal(sample.noData, false, 'PDS specifies interpolation for bins without direct observations');
});

test('MOLA decoder rejects incomplete and incorrectly typed grids', () => {
  assert.throws(() => science.decodeMola(new ArrayBuffer(8), new ArrayBuffer(8)), /exactly/);
  assert.throws(() => science.decodeMola({}, {}), /ArrayBuffer/);
});

test('Mars coordinate conventions validate boundaries, wrap longitude, and convert latitude inversely', () => {
  assert.equal(science.normalizeLongitude(-1), 359);
  assert.equal(science.normalizeLongitude(721), 1);
  assert.deepEqual(science.validateCoordinate(-90, -180), { latitude: -90, longitude: 180 });
  for (const latitude of [-89, -45, 0, 45, 89]) {
    const centric = science.planetographicToPlanetocentric(latitude);
    assert.ok(Math.abs(science.planetocentricToPlanetographic(centric) - latitude) < 1e-10);
  }
  assert.throws(() => science.validateCoordinate(90.01, 0), /Latitude/);
  assert.throws(() => science.validateCoordinate(0, 361), /Longitude/);
});

test('flat MOLA grid yields zero slope and a constant north-south gradient has consistent units', () => {
  const topography = constantRaster(100);
  const areoid = constantRaster(0);
  const flat = science.decodeMola(topography, areoid);
  const flatSlope = science.calculateLocalSlope(flat, 0, 180);
  assert.equal(flatSlope.degrees, 0);
  assert.equal(flatSlope.percent, 0);

  const gradientBytes = Buffer.alloc(science.GRID.width * science.GRID.height * 2);
  const gradientView = new DataView(gradientBytes.buffer, gradientBytes.byteOffset, gradientBytes.byteLength);
  for (let row = 0; row < science.GRID.height; row++) {
    for (let column = 0; column < science.GRID.width; column++) {
      gradientView.setInt16((row * science.GRID.width + column) * 2, row * 2, false);
    }
  }
  const gradient = science.decodeMola(gradientBytes, areoid);
  const slope = science.calculateLocalSlope(gradient, 0, 180);
  assert.ok(slope.degrees > 0 && slope.degrees < 1);
  assert.ok(Math.abs(slope.percent - Math.tan(slope.degrees * Math.PI / 180) * 100) < 1e-10);
  assert.ok(slope.windowKm.eastWest > 29 && slope.windowKm.northSouth > 29);
  assert.equal(science.calculateLocalSlope(flat, 90, 0).valid, false);
});

test('route profiles use continuous cumulative geodesic distance and handle longitude wrapping', () => {
  const grid = science.decodeMola(constantRaster(250), constantRaster(0));
  const single = science.sampleRoute(grid, [{ latitude: 0, longitude: 10 }], 30);
  assert.equal(single.samples.length, 1);
  assert.equal(single.totalDistanceKm, 0);
  const route = science.sampleRoute(grid, [
    { latitude: 0, longitude: 179 },
    { latitude: 0, longitude: -179 },
    { latitude: 1, longitude: -178 }
  ], 30);
  assert.ok(route.samples.length > 2);
  assert.ok(route.totalDistanceKm > 190 && route.totalDistanceKm < 210);
  assert.equal(route.samples[0].distanceKm, 0);
  assert.ok(route.samples.at(-1).distanceKm > route.samples[1].distanceKm);
  assert.ok(route.samples.every(sample => sample.terrain.dataset === science.MOLA_SOURCE.id));
  assert.equal(route.samples[0].slopeDegrees, null);
  assert.ok(route.samples.slice(1).every(sample => Number.isFinite(sample.slopeDegrees)));
  assert.throws(() => science.sampleRoute(grid, [], 30), /waypoints/);
  assert.throws(() => science.sampleRoute(grid, [{ latitude: 0, longitude: 0 }], 5), /spacing/);
});

test('GeoJSON import enforces one bounded LineString and longitude-latitude ordering', () => {
  const route = science.importGeoJSON({
    type: 'Feature',
    properties: { routeType: 'untrusted metadata' },
    geometry: { type: 'LineString', coordinates: [[-5, 4], [6, -7, 10]] }
  });
  assert.deepEqual(route, [{ latitude: 4, longitude: -5 }, { latitude: -7, longitude: 6 }]);
  assert.throws(() => science.importGeoJSON('{invalid'), /valid JSON/);
  assert.throws(() => science.importGeoJSON({ type: 'Point', coordinates: [0, 0] }), /LineString/);
  assert.throws(() => science.importGeoJSON({ type: 'LineString', coordinates: [[200, 0], [0, 0]] }), /coordinate/);
  assert.throws(() => science.importGeoJSON({ type: 'LineString', coordinates: [[0, 0]] }), /2 to 500/);
});

test('mission timeline records are ordered and require source links and consistent end status', () => {
  assert.equal(science.validateMissions(), true);
  assert.equal(science.missions[0].landingDate, '1976-07-20');
  assert.equal(science.missions.at(-1).id, 'perseverance');
  assert.throws(() => science.validateMissions([{ id: 'bad', status: 'Operational', source: 'https://example.org', endDate: '2020-01-01' }]), /inconsistent/);
  assert.throws(() => science.validateMissions([{ id: 'bad', status: 'Unknown', source: 'not a URL', endDate: null }]), /source URL/);
});
