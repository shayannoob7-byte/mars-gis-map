const { test } = require('node:test');
const assert = require('node:assert/strict');
const terrain = require('../terrain-model.js');

test('curated regional terrain presets are unique and carry coverage metadata', () => {
  assert.equal(terrain.REGIONS.length, 10);
  assert.equal(new Set(terrain.REGIONS.map(region => region.id)).size, terrain.REGIONS.length);
  assert.ok(terrain.REGIONS.every(region =>
    region.file.endsWith('.bin') &&
    region.resolutionMeters === 463 &&
    region.patchSize === terrain.SIZE &&
    region.halfExtentKm === terrain.HALF_EXTENT_KM
  ));
});

test('regional raster decoder reads signed big-endian metre samples and validates size', () => {
  const bytes = Buffer.alloc(terrain.SIZE * terrain.SIZE * 2);
  bytes.writeInt16BE(-1234, 0);
  bytes.writeInt16BE(0, 2);
  bytes.writeInt16BE(21249, bytes.length - 2);
  const patch = terrain.decodePatch(bytes);
  assert.equal(patch.elevations[0], -1234);
  assert.equal(patch.elevations[1], 0);
  assert.equal(patch.elevations.at(-1), 21249);
  assert.throws(() => terrain.decodePatch(new ArrayBuffer(8)), /exactly/);
});

test('terrain mesh builds finite, indexed geometry and rejects invalid extents', () => {
  const patch = { size: 4, halfExtentKm: 5, elevations: Int16Array.from([
    -100, 0, 100, 200,
    -50, 50, 150, 250,
    0, 100, 200, 300,
    50, 150, 250, 350
  ]) };
  const mesh = terrain.buildMesh(patch, 8, 3, 16);
  assert.equal(mesh.vertices.length, 16 * 16 * 6);
  assert.equal(mesh.indices.length, 15 * 15 * 6);
  assert.ok(Math.abs(mesh.minimumElevationM + 55) < 1e-8);
  assert.ok(Math.abs(mesh.maximumElevationM - 305) < 1e-8);
  assert.ok([...mesh.vertices].every(Number.isFinite));
  assert.throws(() => terrain.buildMesh(patch, 11), /fit inside/);
  assert.throws(() => terrain.buildMesh(patch, 8, 9), /exaggeration/);
});

test('Terrain Explorer texture reuses its elevation palette and triangular edge treatment', () => {
  const patch = {
    size: 16,
    halfExtentKm: 5,
    elevations: Int16Array.from({ length: 16 * 16 }, (_, index) => (index % 16) * 100 + Math.floor(index / 16) * 10)
  };
  const fillStyles = [];
  let strokes = 0;
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { fillStyles.push(this.fillStyle); },
    stroke() { strokes++; }
  };
  const priorDocument = global.document;
  const hadDocument = Object.hasOwn(global, 'document');
  global.document = {
    createElement() {
      return {
        getContext: () => context,
        width: 0,
        height: 0
      };
    }
  };
  try {
    const texture = terrain.createExplorerTexture(patch, 10, 16);
    const mesh = terrain.buildMesh(patch, 10, 3, 16);
    const firstVertexColor = [...mesh.vertices.slice(3, 6)].map(Math.round);
    assert.equal(texture.width, 32);
    assert.equal(texture.height, 32);
    assert.equal(fillStyles[0], `rgb(${firstVertexColor.join(',')})`);
    assert.equal(fillStyles.length, mesh.indices.length / 3);
    assert.equal(strokes, mesh.indices.length / 3);
    assert.equal(context.strokeStyle, 'rgba(13, 15, 18, .16)');
    assert.equal(context.lineWidth, 0.7);
    assert.equal(terrain.createExplorerTexture(patch, 10, 16), texture);
  } finally {
    if (hadDocument) global.document = priorDocument;
    else delete global.document;
  }
});

test('custom coordinate patches sample global MOLA on a bounded square', () => {
  let samples = 0;
  const data = {
    MOLA_SOURCE: { resolutionKmAtEquator: 14.818 },
    validateCoordinate(latitude, longitude) {
      if (latitude < -90 || latitude > 90) throw new RangeError('latitude');
      return { latitude, longitude: ((longitude % 360) + 360) % 360 };
    },
    sampleElevation(_grid, latitude, longitude) {
      samples++;
      return { elevationM: latitude * 10 + longitude };
    }
  };
  const patch = terrain.createGridPatch({}, data, 10, -20, 50, 16);
  assert.equal(samples, 16 * 16);
  assert.equal(patch.size, 16);
  assert.equal(patch.halfExtentKm, 25);
  assert.equal(patch.resolutionMeters, 14818);
  assert.throws(() => terrain.createGridPatch({}, data, 89.9, 0, 50), /89.9/);
  assert.throws(() => terrain.createGridPatch({}, data, 0, 0, 101), /between 1 and 100/);
});
