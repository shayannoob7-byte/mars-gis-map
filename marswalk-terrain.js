(function (root) {
  'use strict';

  const MARS_MEAN_RADIUS_M = 3389500;
  const THEMIS_WMS = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv';
  const THEMIS_MAP = '/maps/mars/mars_simp_cyl.map';
  const PALETTE = [
    [61, 43, 38], [88, 55, 45], [118, 71, 51], [148, 88, 57],
    [174, 108, 66], [194, 130, 79], [207, 151, 96], [218, 172, 117],
    [228, 191, 142], [236, 208, 164], [243, 222, 187], [250, 237, 215]
  ];

  function wrapLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function getCoverageBounds(region, science) {
    if (!science || typeof science.planetographicToPlanetocentric !== 'function' ||
        typeof science.planetocentricToPlanetographic !== 'function') {
      throw new TypeError('Coverage metadata and Mars latitude converters are required.');
    }
    if (!region || typeof region.id !== 'string' || typeof region.name !== 'string' ||
        !Number.isFinite(region.latitude) || Math.abs(region.latitude) > 90 ||
        !Number.isFinite(region.longitude) || !Number.isFinite(region.halfExtentKm) ||
        region.halfExtentKm <= 0 || !Number.isInteger(region.patchSize) || region.patchSize < 2 ||
        !Number.isFinite(region.resolutionMeters) || region.resolutionMeters <= 0 ||
        typeof region.file !== 'string' || !region.file ||
        typeof region.sourceProduct !== 'string' || !region.sourceProduct) {
      throw new RangeError('This DEM coverage has unsupported or incomplete geographic and data metadata.');
    }
    const centerPlanetocentricLatitude = science.planetographicToPlanetocentric(region.latitude);
    const latitudeDelta = region.halfExtentKm * 1000 / MARS_MEAN_RADIUS_M * 180 / Math.PI;
    const longitudeDelta = latitudeDelta /
      Math.max(0.001, Math.cos(centerPlanetocentricLatitude * Math.PI / 180));
    const southLatitude = science.planetocentricToPlanetographic(centerPlanetocentricLatitude - latitudeDelta);
    const northLatitude = science.planetocentricToPlanetographic(centerPlanetocentricLatitude + latitudeDelta);
    if (southLatitude < -90 || northLatitude > 90) {
      throw new RangeError('This DEM coverage extends beyond supported geographic latitudes.');
    }
    return Object.freeze({
      id: region.id,
      name: region.name,
      centerLatitude: region.latitude,
      centerLongitude: wrapLongitude(region.longitude),
      westLongitude: wrapLongitude(region.longitude - longitudeDelta),
      eastLongitude: wrapLongitude(region.longitude + longitudeDelta),
      southLatitude,
      northLatitude,
      halfExtentKm: region.halfExtentKm,
      widthKm: region.halfExtentKm * 2,
      patchSize: region.patchSize,
      resolutionMetersAtEquator: region.resolutionMeters,
      sourceProduct: region.sourceProduct,
      dataFile: region.file
    });
  }

  function createImageryRequest(region, science) {
    if (!region || !science || typeof science.planetographicToPlanetocentric !== 'function') {
      throw new TypeError('A regional patch and Mars coordinate converter are required.');
    }
    const centerLatitude = science.planetographicToPlanetocentric(region.latitude);
    const latitudeDelta = region.halfExtentKm * 1000 / MARS_MEAN_RADIUS_M * 180 / Math.PI;
    if (Math.abs(centerLatitude) + latitudeDelta > 88) return null;
    const longitudeDelta = latitudeDelta / Math.max(0.001, Math.cos(centerLatitude * Math.PI / 180));
    const parameters = new URLSearchParams({
      map: THEMIS_MAP,
      service: 'WMS',
      version: '1.1.1',
      request: 'GetMap',
      layers: 'MOLA_THEMIS_blend',
      styles: '',
      srs: 'EPSG:4326',
      bbox: [
        centerLongitude(region.longitude) - longitudeDelta,
        centerLatitude - latitudeDelta,
        centerLongitude(region.longitude) + longitudeDelta,
        centerLatitude + latitudeDelta
      ].join(','),
      width: String(Math.round(region.halfExtentKm * 2000 / 100)),
      height: String(Math.round(region.halfExtentKm * 2000 / 100)),
      format: 'image/png',
      transparent: 'TRUE'
    });
    return Object.freeze({
      url: `${THEMIS_WMS}?${parameters}`,
      name: 'MOLA topography and THEMIS IR Day global blend',
      resolutionMeters: 100,
      coverage: 'Near-global WMS; MarsWalk requests patches only within 88° latitude',
      sourceUrl: 'https://planetarymaps.usgs.gov/',
      attribution: 'NASA / JPL-Caltech / Arizona State University / USGS Astrogeology',
      patchId: region.id
    });
  }

  function createSurfaceTexture(terrain, image = null) {
    if (!terrain?.region || !terrain.patch) {
      throw new TypeError('A regional terrain sampler is required to create a surface texture.');
    }
    const size = terrain.patch.size;
    const base = document.createElement('canvas');
    base.width = size;
    base.height = size;
    const baseContext = base.getContext('2d');
    if (!baseContext) throw new Error('A 2D canvas is required to color the regional DEM.');
    const imageData = baseContext.createImageData(size, size);
    const elevations = terrain.patch.elevations;
    let minimum = Infinity, maximum = -Infinity;
    for (const elevation of elevations) {
      minimum = Math.min(minimum, elevation);
      maximum = Math.max(maximum, elevation);
    }
    for (let index = 0; index < elevations.length; index++) {
      const fraction = maximum === minimum ? 0.5 : (elevations[index] - minimum) / (maximum - minimum);
      const colorIndex = Math.max(0, Math.min(PALETTE.length - 1, Math.floor(fraction * PALETTE.length)));
      const offset = index * 4;
      imageData.data[offset] = PALETTE[colorIndex][0];
      imageData.data[offset + 1] = PALETTE[colorIndex][1];
      imageData.data[offset + 2] = PALETTE[colorIndex][2];
      imageData.data[offset + 3] = 255;
    }
    baseContext.putImageData(imageData, 0, 0);
    if (image) {
      const probe = document.createElement('canvas');
      probe.width = 32;
      probe.height = 32;
      const probeContext = probe.getContext('2d');
      if (!probeContext) throw new Error('A 2D canvas is required to validate the regional imagery.');
      probeContext.drawImage(image, 0, 0, probe.width, probe.height);
      const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
      let firstColor = null;
      let hasColorVariation = false;
      let visiblePixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) continue;
        visiblePixels++;
        const color = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
        if (firstColor === null) firstColor = color;
        else if (color !== firstColor) hasColorVariation = true;
      }
      if (visiblePixels < probe.width * probe.height / 2 || !hasColorVariation) {
        throw new Error('The imagery response is blank or transparent.');
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = image?.width || size;
    canvas.height = image?.height || size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas is required to prepare the regional surface texture.');
    context.drawImage(base, 0, 0, canvas.width, canvas.height);
    if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function centerLongitude(longitude) {
    return wrapLongitude(longitude);
  }

  function createRegionalTerrain(region, patch, datumGrid, science) {
    if (!region || !patch || !datumGrid?.topography || !datumGrid?.areoid ||
        !science || typeof science.sampleElevation !== 'function') {
      throw new TypeError('A regional MOLA patch, datum grid, and terrain samplers are required.');
    }
    if (patch.elevations.includes(-32768)) {
      throw new Error('The regional DEM contains unsupported -32768 no-data cells and cannot be rendered safely.');
    }
    const centerLatitude = science.planetographicToPlanetocentric(region.latitude);
    const centerLongitude = wrapLongitude(region.longitude);
    const halfExtentM = region.halfExtentKm * 1000;
    const patchWidthM = halfExtentM * 2;
    const source = Object.freeze({
      id: `MOLA-MEGDR-128PPD-${region.id}`,
      name: 'NASA MOLA MEGDR 128 pixels/degree regional patch',
      version: '2.0',
      resolutionMetersAtEquator: region.resolutionMeters,
      widthMeters: patchWidthM,
      verticalReference: 'GMM3 areoid',
      horizontalReference: 'IAU 2000 Mars; planetocentric latitude; east-positive longitude',
      sourceProduct: region.sourceProduct,
      sourceUrl: region.source,
      attribution: 'NASA / MOLA Science Team / PDS Geosciences Node',
      regionId: region.id
    });

    function localCoordinates(point) {
      if (!Number.isFinite(point?.latitude) || point.latitude < -90 || point.latitude > 90 ||
          !Number.isFinite(point?.longitude)) {
        throw new RangeError('A finite Mars latitude and longitude are required.');
      }
      const latitude = science.planetographicToPlanetocentric(point.latitude);
      const longitudeDelta = wrapLongitude(point.longitude - centerLongitude);
      const eastM = longitudeDelta * Math.PI / 180 * MARS_MEAN_RADIUS_M *
        Math.cos(centerLatitude * Math.PI / 180);
      const northM = (latitude - centerLatitude) * Math.PI / 180 * MARS_MEAN_RADIUS_M;
      return { eastM, northM, latitude, longitude: wrapLongitude(point.longitude) };
    }

    function rasterCoordinates(point) {
      const local = localCoordinates(point);
      const column = (local.eastM / patchWidthM + 0.5) * (patch.size - 1);
      const row = (0.5 - local.northM / patchWidthM) * (patch.size - 1);
      return { ...local, column, row };
    }

    function interpolateMeshTriangle(position) {
      const row = Math.min(patch.size - 2, Math.max(0, Math.floor(position.row)));
      const column = Math.min(patch.size - 2, Math.max(0, Math.floor(position.column)));
      const rowFraction = position.row - row;
      const columnFraction = position.column - column;
      const topLeft = patch.elevations[row * patch.size + column];
      const topRight = patch.elevations[row * patch.size + column + 1];
      const bottomLeft = patch.elevations[(row + 1) * patch.size + column];
      const bottomRight = patch.elevations[(row + 1) * patch.size + column + 1];
      const vertices = rowFraction + columnFraction <= 1
        ? [[topLeft, row, column], [bottomLeft, row + 1, column], [topRight, row, column + 1]]
        : [[topRight, row, column + 1], [bottomLeft, row + 1, column],
          [bottomRight, row + 1, column + 1]];
      const weights = rowFraction + columnFraction <= 1
        ? [1 - rowFraction - columnFraction, rowFraction, columnFraction]
        : [1 - rowFraction, 1 - columnFraction, rowFraction + columnFraction - 1];
      let elevationM = 0;
      let localElevationM = 0;
      for (let index = 0; index < vertices.length; index++) {
        const [elevation, vertexRow, vertexColumn] = vertices[index];
        const eastM = (vertexColumn / (patch.size - 1) - 0.5) * patchWidthM;
        const northM = (0.5 - vertexRow / (patch.size - 1)) * patchWidthM;
        const curvatureM = (eastM ** 2 + northM ** 2) / (2 * MARS_MEAN_RADIUS_M);
        elevationM += elevation * weights[index];
        localElevationM += (elevation - curvatureM) * weights[index];
      }
      return { elevationM, localElevationM };
    }

    const centerMeshSample = interpolateMeshTriangle({
      row: (patch.size - 1) / 2,
      column: (patch.size - 1) / 2
    });
    const referenceElevationM = centerMeshSample.elevationM;
    const referenceLocalElevationM = centerMeshSample.localElevationM;

    function sample(point) {
      const position = rasterCoordinates(point);
      if (position.row < 0 || position.row > patch.size - 1 ||
          position.column < 0 || position.column > patch.size - 1) {
        return { valid: false, dataset: source.id, resolutionMetersAtEquator: source.resolutionMetersAtEquator };
      }
      const meshSample = interpolateMeshTriangle(position);
      const datum = science.sampleElevation(datumGrid, point.latitude, point.longitude);
      if (!datum?.valid) {
        throw new Error('The MOLA areoid datum sample required for height conversion is unavailable.');
      }
      const areoidRadiusM = datum.radialRadiusM - datum.elevationM;
      const radialRadiusM = areoidRadiusM + meshSample.elevationM;
      return {
        valid: true,
        elevationM: meshSample.elevationM,
        radialRadiusM,
        planetocentricLatitude: position.latitude,
        localEastM: position.eastM,
        localNorthM: position.northM,
        localElevationM: meshSample.localElevationM,
        dataset: source.id,
        resolutionKmAtEquator: source.resolutionMetersAtEquator / 1000,
        resolutionMetersAtEquator: source.resolutionMetersAtEquator,
        verticalReference: source.verticalReference,
        qualityNote: 'Regional MOLA 128 pixels/degree elevation; archive-interpolated cells may be present.'
      };
    }

    function localPosition(point, heightM = null) {
      const samplePoint = sample(point);
      if (!samplePoint.valid) {
        throw new RangeError('The point is outside the selected regional DEM coverage.');
      }
      return {
        x: samplePoint.localEastM,
        y: samplePoint.localNorthM,
        z: heightM === null ? samplePoint.localElevationM : samplePoint.localElevationM + heightM
      };
    }

    function inspectLocalPosition(position) {
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
        throw new TypeError('Finite local terrain coordinates are required for inspection.');
      }
      const latitude = science.planetocentricToPlanetographic(
        centerLatitude + position.y / MARS_MEAN_RADIUS_M * 180 / Math.PI
      );
      const longitude = wrapLongitude(
        centerLongitude + position.x / (MARS_MEAN_RADIUS_M * Math.cos(centerLatitude * Math.PI / 180)) *
          180 / Math.PI
      );
      const point = { latitude, longitude };
      const sampled = sample(point);
      if (!sampled.valid) return null;

      const meshSample = interpolateMeshTriangle(rasterCoordinates(point));
      return Object.freeze({
        latitude,
        longitude,
        sampleElevationM: sampled.elevationM,
        localHeightM: sampled.localElevationM - referenceLocalElevationM,
        meshElevationM: meshSample.elevationM,
        meshLocalHeightM: meshSample.localElevationM,
        meshSampleDeltaM: meshSample.elevationM - sampled.elevationM,
        referenceElevationM,
        resolutionMetersAtEquator: source.resolutionMetersAtEquator
      });
    }

    function buildMesh(includeHypsometricBands = true) {
      const size = patch.size;
      const bandVertices = includeHypsometricBands
        ? Array.from({ length: PALETTE.length }, () => []) : null;
      let minimumElevationM = Infinity;
      let maximumElevationM = -Infinity;
      for (const elevationM of patch.elevations) {
        minimumElevationM = Math.min(minimumElevationM, elevationM);
        maximumElevationM = Math.max(maximumElevationM, elevationM);
      }
      const positions = new Float64Array(size * size * 3);
      const normals = new Float32Array(size * size * 3);
      const textureCoordinates = new Float32Array(size * size * 2);
      const spacingM = patchWidthM / (size - 1);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const index = row * size + column;
          const eastM = (column / (size - 1) - 0.5) * patchWidthM;
          const northM = (0.5 - row / (size - 1)) * patchWidthM;
          const curvatureM = (eastM ** 2 + northM ** 2) / (2 * MARS_MEAN_RADIUS_M);
          positions[index * 3] = eastM;
          positions[index * 3 + 1] = northM;
          positions[index * 3 + 2] = patch.elevations[index] - curvatureM;
          textureCoordinates[index * 2] = column / (size - 1);
          textureCoordinates[index * 2 + 1] = 1 - row / (size - 1);
        }
      }
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const northRow = Math.max(0, row - 1), southRow = Math.min(size - 1, row + 1);
          const westColumn = Math.max(0, column - 1), eastColumn = Math.min(size - 1, column + 1);
          const eastRun = (eastColumn - westColumn) * spacingM;
          const northRun = (southRow - northRow) * spacingM;
          const dzEast = (positions[(row * size + eastColumn) * 3 + 2] -
            positions[(row * size + westColumn) * 3 + 2]) / eastRun;
          const dzNorth = (positions[(northRow * size + column) * 3 + 2] -
            positions[(southRow * size + column) * 3 + 2]) / northRun;
          let nx = -dzEast, ny = -dzNorth, nz = 1;
          const magnitude = Math.hypot(nx, ny, nz);
          const offset = (row * size + column) * 3;
          normals[offset] = nx / magnitude;
          normals[offset + 1] = ny / magnitude;
          normals[offset + 2] = nz / magnitude;
        }
      }
      const indices = new Uint32Array((size - 1) * (size - 1) * 6);
      let indexOffset = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let column = 0; column < size - 1; column++) {
          const topLeft = row * size + column;
          const topRight = topLeft + 1;
          const bottomLeft = topLeft + size;
          const bottomRight = bottomLeft + 1;
          for (const triangle of [[topLeft, bottomLeft, topRight], [topRight, bottomLeft, bottomRight]]) {
            indices.set(triangle, indexOffset);
            indexOffset += 3;
            if (!bandVertices) continue;
            const meanElevationM = triangle.reduce((sum, index) => sum + patch.elevations[index], 0) / 3;
            const fraction = maximumElevationM === minimumElevationM ? 0.5 :
              (meanElevationM - minimumElevationM) / (maximumElevationM - minimumElevationM);
            const band = Math.max(0, Math.min(PALETTE.length - 1, Math.floor(fraction * PALETTE.length)));
            const a = triangle[0] * 3, b = triangle[1] * 3, c = triangle[2] * 3;
            const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1],
              abz = positions[b + 2] - positions[a + 2];
            const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1],
              acz = positions[c + 2] - positions[a + 2];
            let nx = aby * acz - abz * acy;
            let ny = abz * acx - abx * acz;
            let nz = abx * acy - aby * acx;
            const magnitude = Math.hypot(nx, ny, nz) || 1;
            nx /= magnitude; ny /= magnitude; nz /= magnitude;
            for (const index of triangle) {
              const offset = index * 3;
              bandVertices[band].push(
                positions[offset], positions[offset + 1], positions[offset + 2],
                nx, ny, nz
              );
            }
          }
        }
      }
      const bands = bandVertices ? bandVertices.map((vertices, index) => ({
        color: PALETTE[index],
        values: new Float64Array(vertices)
      })).filter(band => band.values.length > 0) : [];
      return Object.freeze({
        bands,
        positions,
        normals,
        textureCoordinates,
        indices,
        size,
        minimumElevationM,
        maximumElevationM,
        widthMeters: patchWidthM,
        resolutionMetersAtEquator: source.resolutionMetersAtEquator
      });
    }

    return Object.freeze({
      region, source, patch, sample, localCoordinates, localPosition,
      inspectLocalPosition, referenceElevationM, buildMesh
    });
  }

  const api = Object.freeze({
    createRegionalTerrain, createImageryRequest, createSurfaceTexture, getCoverageBounds
  });
  root.MarsWalkTerrain = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
