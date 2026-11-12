const { test } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../marswalk-planner.js');
const science = require('../science-data.js');

function raster(valueAt) {
  const buffer = Buffer.alloc(science.GRID.width * science.GRID.height * 2);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let row = 0; row < science.GRID.height; row++) {
    const latitude = 90 - (row + 0.5) * science.GRID.degreesPerPixel;
    for (let column = 0; column < science.GRID.width; column++) {
      const longitude = column * science.GRID.degreesPerPixel + science.GRID.degreesPerPixel / 2;
      const value = valueAt(latitude, longitude);
      view.setInt16((row * science.GRID.width + column) * 2, value, false);
    }
  }
  return buffer;
}

function gridWithElevation(elevationAt = () => 0) {
  const topography = raster((latitude, longitude) => elevationAt(latitude, longitude));
  const areoid = raster(() => 0);
  return science.decodeMola(topography, areoid);
}

test('planner validates Mars coordinates, longitude wrapping, and ambiguous routes', () => {
  assert.deepEqual(planner.validatePoint({ latitude: 12, longitude: 360 }, 'Start'), {
    latitude: 12, longitude: 0
  });
  assert.throws(() => planner.validatePoint({ latitude: 91, longitude: 0 }, 'Start'), /latitude/);
  assert.throws(() => planner.validatePoint({ latitude: 12, longitude: 361 }, 'Start'), /longitude/);
  assert.throws(() => planner.planRoute({}, science, { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 1 }), /decoded NASA MOLA/);
  assert.throws(() => planner.planRoute(gridWithElevation(), science,
    { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), /distinct locations/);
  assert.throws(() => planner.planRoute(gridWithElevation(), science,
    { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }), /antipodal|ambiguous/);
});

test('flat synthetic MOLA terrain produces a sampled, clearance-verified route', () => {
  const grid = gridWithElevation();
  const result = planner.planRoute(grid, science,
    { latitude: 0, longitude: 10 }, { latitude: 0.35, longitude: 10.4 },
    { mode: 'follow', clearanceM: 1800, maxHeightM: 80000 });
  assert.ok(result.trajectory.length > 2);
  assert.equal(result.dataset.id, science.MOLA_SOURCE.id);
  assert.equal(result.minimumClearanceM, 1800);
  assert.ok(result.maximumFlightElevationM < 10000);
  assert.ok(result.routeDistanceKm >= result.directDistanceKm);
  assert.ok(result.trajectory.every(point => point.terrain.valid && point.clearanceM >= 1800));
  assert.equal(result.trajectory[0].latitude, 0);
  assert.equal(result.trajectory.at(-1).latitude, 0.35);
});

test('high-latitude and antimeridian routes retain valid endpoints and geodesic distance', () => {
  const grid = gridWithElevation();
  const forward = planner.planRoute(grid, science,
    { latitude: 74, longitude: 179.4 }, { latitude: 74.4, longitude: -179.7 },
    { mode: 'cinematic', clearanceM: 4200, maxHeightM: 100000 });
  const reverse = planner.planRoute(grid, science,
    { latitude: 74.4, longitude: -179.7 }, { latitude: 74, longitude: 179.4 },
    { mode: 'cinematic', clearanceM: 4200, maxHeightM: 100000 });
  assert.ok(Math.abs(forward.directDistanceKm - reverse.directDistanceKm) < 0.001);
  assert.ok(forward.trajectory.every(point => point.latitude >= -90 && point.latitude <= 90));
  assert.ok(Math.abs(forward.trajectory.at(-1).longitude - (-179.7)) < 0.001);
  assert.ok(Math.abs(reverse.trajectory.at(-1).longitude - 179.4) < 0.001);
});

test('terrain-aware corridor detours around a synthetic ridge and adjusts flight height', () => {
  const ridge = gridWithElevation((latitude, longitude) => {
    const wrappedLon = ((longitude + 180) % 360) - 180;
    const radius = (latitude / 0.55) ** 2 + (wrappedLon / 0.55) ** 2;
    return Math.round(7000 * Math.exp(-radius));
  });
  const start = { latitude: -1, longitude: 0 };
  const destination = { latitude: 1, longitude: 0 };
  const directProfile = science.sampleRoute(ridge, [start, destination], 15);
  const direct = planner.planRoute(ridge, science,
    start, destination,
    { mode: 'follow', clearanceM: 1800, maxHeightM: 80000 });
  assert.ok(Math.max(...directProfile.samples.map(point => point.terrain.elevationM)) > 4000);
  assert.ok(direct.maximumDeviationKm > 0, 'the selected route uses an off-axis corridor');
  assert.ok(direct.minimumClearanceM >= 1800);
  assert.ok(direct.trajectory.some(point => point.flightHeightM > direct.trajectory[0].flightHeightM));
  const overview = planner.planRoute(ridge, science,
    start, destination,
    { mode: 'overview', clearanceM: 18000, maxHeightM: 120000 });
  assert.ok(overview.maximumFlightElevationM > direct.maximumFlightElevationM);
  assert.notEqual(overview.costFunction, direct.costFunction);
});

test('altitude limits and terrain sampling failures reject planning explicitly', () => {
  const grid = gridWithElevation(() => 12000);
  assert.throws(() => planner.planRoute(grid, science,
    { latitude: 1, longitude: 1 }, { latitude: 1.1, longitude: 1 },
    { mode: 'follow', clearanceM: 3000, maxHeightM: 10000 }), /above the selected/);
  const brokenScience = {
    ...science,
    sampleElevation() { return { valid: false }; }
  };
  assert.throws(() => planner.planRoute(grid, brokenScience,
    { latitude: 1, longitude: 1 }, { latitude: 1.1, longitude: 1 }), /sample is unavailable/);
});

test('MarsWalk presets require named regional terrain coverage, not the global source', () => {
  assert.ok(planner.PRESETS.every(item => item.regionId && item.source.includes('128 pixels/degree')));
  assert.ok(planner.PRESETS.every(item => /curated|exploration/i.test(item.description)));
  assert.ok(planner.PRESETS.every(item => /not .*traverse/i.test(item.description)));
});

test('trajectory seeking interpolates position and altitude without restarting', () => {
  const trajectory = [
    { latitude: 0, longitude: 0, distanceKm: 0, flightHeightM: 1000, terrainHeightM: 0, clearanceM: 1000, terrain: { valid: true } },
    { latitude: 0, longitude: 1, distanceKm: 59, flightHeightM: 2000, terrainHeightM: 500, clearanceM: 1500, terrain: { valid: true } }
  ];
  const middle = planner.sampleTrajectory(trajectory, 0.5);
  assert.equal(middle.latitude, 0);
  assert.ok(Math.abs(middle.longitude - 0.5) < 1e-8);
  assert.equal(middle.flightHeightM, 1500);
  assert.equal(middle.clearanceM, 1250);
  assert.equal(planner.sampleTrajectory(trajectory, 2).longitude, 1);
  const uneven = [
    { latitude: 0, longitude: 0, distanceKm: 0, flightHeightM: 1000, terrainHeightM: 0, clearanceM: 1000, terrain: { valid: true } },
    { latitude: 0, longitude: 0.1, distanceKm: 10, flightHeightM: 1100, terrainHeightM: 0, clearanceM: 1100, terrain: { valid: true } },
    { latitude: 0, longitude: 1, distanceKm: 100, flightHeightM: 2000, terrainHeightM: 0, clearanceM: 2000, terrain: { valid: true } }
  ];
  const byDistance = planner.sampleTrajectory(uneven, 0.5);
  assert.equal(byDistance.index, 1);
  assert.ok(Math.abs(byDistance.longitude - 0.5) < 1e-8);
  assert.equal(byDistance.distanceKm, 50);
});

test('camera basis keeps a stable frame when the flight direction is near vertical', () => {
  const vertical = planner.computeCameraBasis([0, 0, 1]);
  assert.ok(vertical.direction.every(Number.isFinite));
  assert.ok(vertical.right.every(Number.isFinite));
  assert.ok(vertical.up.every(Number.isFinite));
  assert.ok(Math.abs(vertical.direction[2] - 1) < 1e-8);
  assert.ok(Math.abs(vertical.right[0]) > 0.9 || Math.abs(vertical.right[1]) > 0.9);

  const diagonal = planner.computeCameraBasis([0.2, 0.1, 0.97]);
  assert.ok(diagonal.direction.every(Number.isFinite));
  assert.ok(diagonal.right.every(Number.isFinite));
  assert.ok(diagonal.up.every(Number.isFinite));
  assert.ok(Math.abs(diagonal.direction[2]) > 0.9);
});

test('camera basis rejects invalid directions instead of silently falling back to a default frame', () => {
  assert.throws(() => planner.computeCameraBasis(), /3D camera direction/);
  assert.throws(() => planner.computeCameraBasis('north'), /3D camera direction/);
  assert.throws(() => planner.computeCameraBasis([0, 0, 0]), /non-zero 3D vector/);
});
