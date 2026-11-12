const { test } = require('node:test');
const assert = require('node:assert/strict');
const navigation = require('../marswalk-navigation.js');

test('zoom bounds scale with the regional terrain patch and relief', () => {
  const small = navigation.getZoomLimits(50000, 800);
  const large = navigation.getZoomLimits(200000, 800);
  const rugged = navigation.getZoomLimits(50000, 12000);
  assert.ok(large.maximum > small.maximum);
  assert.ok(rugged.minimum > small.minimum);
  assert.ok(small.minimum < small.initial && small.initial < small.maximum);
  assert.throws(() => navigation.getZoomLimits(0), /finite positive distances/);
});

test('wheel input supports pixel, line, and page units without changing gestures outside the canvas', () => {
  assert.equal(navigation.normalizeWheelDelta({ deltaY: 3, deltaMode: 0 }), 3);
  assert.equal(navigation.normalizeWheelDelta({ deltaY: 3, deltaMode: 1 }), 48);
  assert.equal(navigation.normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }, 600), 600);
  assert.throws(() => navigation.normalizeWheelDelta({ deltaY: NaN }), /finite wheel delta/);
});

test('smooth wheel and pinch zoom remain bounded and recover from either limit', () => {
  const limits = navigation.getZoomLimits(100000, 2000);
  const middle = limits.initial;
  const zoomedIn = navigation.zoomDistance(middle, -20, limits);
  const zoomedOut = navigation.zoomDistance(middle, 20, limits);
  assert.ok(zoomedIn < middle && middle < zoomedOut);
  assert.equal(navigation.zoomDistance(limits.minimum, -10000, limits), limits.minimum);
  assert.equal(navigation.zoomDistance(limits.maximum, 10000, limits), limits.maximum);
  const recovered = navigation.zoomDistance(limits.maximum, -100, limits);
  assert.ok(recovered < limits.maximum);
});

test('orbit controls rotate freely in azimuth while keeping overhead and low-oblique pitch stable', () => {
  const start = navigation.getOrbitAngles(
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 100 }
  );
  const horizontal = navigation.orbitAngles(start.yaw, start.pitch, 100, 0);
  const overhead = navigation.orbitAngles(start.yaw, start.pitch, 0, 10000);
  const lower = navigation.orbitAngles(start.yaw, start.pitch, 0, -10000);
  assert.ok(horizontal.yaw < start.yaw);
  assert.ok(overhead.pitch > start.pitch && overhead.pitch < Math.PI / 2);
  assert.ok(lower.pitch > 0 && lower.pitch < start.pitch);
  assert.ok(Math.abs(navigation.getOrbitAngles(
    { x: 0, y: 0, z: 0 },
    { x: Math.cos(horizontal.yaw), y: Math.sin(horizontal.yaw), z: Math.sin(horizontal.pitch) }
  ).yaw - horizontal.yaw) < 1e-12);
});

test('screen-space panning follows the camera orientation and drag convention', () => {
  const atEastSide = navigation.panOffset(100, 0, 1000, Math.PI / 3, 500, 0, 0.6);
  const atNorthSide = navigation.panOffset(100, 0, 1000, Math.PI / 3, 500, Math.PI / 2, 0.6);
  const down = navigation.panOffset(0, 100, 1000, Math.PI / 3, 500, 0, 0.6);
  assert.ok(Math.abs(atEastSide[0]) < 1e-9);
  assert.ok(atEastSide[1] < 0);
  assert.ok(atNorthSide[0] > 0);
  assert.ok(Math.abs(atNorthSide[1]) < 1e-9);
  assert.ok(down[0] < 0);
});

test('wheel input separates trackpad pan and pinch from mouse-wheel zoom', () => {
  assert.deepEqual(
    navigation.classifyWheel({ deltaX: 4, deltaY: 12, deltaMode: 0 }),
    { type: 'pan', deltaX: 4, deltaY: 12 }
  );
  assert.deepEqual(
    navigation.classifyWheel({ deltaX: 0, deltaY: 12, deltaMode: 0, ctrlKey: true }),
    { type: 'zoom', delta: 12 }
  );
  assert.deepEqual(
    navigation.classifyWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }),
    { type: 'zoom', delta: 48 }
  );
  assert.deepEqual(
    navigation.classifyWheel({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true }),
    { type: 'pan', deltaX: 48, deltaY: 0 }
  );
});

test('shared flight progress reflects every supported playback speed and clamps at landing', () => {
  for (const speed of navigation.SPEED_OPTIONS) {
    assert.equal(navigation.advanceProgress(0.25, 10, speed, 100), Math.min(1, 0.25 + speed / 10));
  }
  assert.equal(navigation.advanceProgress(0.95, 10, 8, 100), 1);
  assert.throws(() => navigation.advanceProgress(0, 1, 3, 10), /supported speed/);
  assert.throws(() => navigation.advanceProgress(0, 1, 1, 0), /positive duration/);
});
