(function (root) {
  'use strict';

  const MARS_MEAN_RADIUS_M = 3389500;
  const GRID_STEP_KM = 15;
  const OFFSETS = [-2, -1, 0, 1, 2];
  const MODES = Object.freeze({
    follow: Object.freeze({ label: 'Terrain follow', clearanceM: 1800, maxHeightM: 80000, smoothness: 0.2, obstacleWeight: 25 }),
    cinematic: Object.freeze({ label: 'Cinematic', clearanceM: 4200, maxHeightM: 100000, smoothness: 0.4, obstacleWeight: 12 }),
    overview: Object.freeze({ label: 'High-altitude overview', clearanceM: 18000, maxHeightM: 120000, smoothness: 0.15, obstacleWeight: 2 }),
    custom: Object.freeze({ label: 'Custom', clearanceM: 3000, maxHeightM: 100000, smoothness: 0.3, obstacleWeight: 12 })
  });
  const PRESETS = Object.freeze([
    Object.freeze({
      id: 'jezero', name: 'Jezero Crater', region: 'Jezero / Isidis Planitia',
      regionId: 'jezero-perseverance',
      start: Object.freeze({ latitude: 18.43, longitude: 77.42 }),
      destination: Object.freeze({ latitude: 18.54, longitude: 77.58 }),
      description: 'A curated regional exploration near the Perseverance landing site; not a rover traverse.',
      mode: 'cinematic', clearanceM: 4200,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    }),
    Object.freeze({
      id: 'gale', name: 'Gale Crater', region: 'Gale Crater',
      regionId: 'gale-curiosity',
      start: Object.freeze({ latitude: -4.61, longitude: 137.39 }),
      destination: Object.freeze({ latitude: -4.52, longitude: 137.58 }),
      description: 'A curated regional exploration near Curiosity; not an official rover traverse.',
      mode: 'follow', clearanceM: 2400,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    }),
    Object.freeze({
      id: 'gusev', name: 'Gusev Crater', region: 'Gusev Crater',
      regionId: 'gusev-spirit',
      start: Object.freeze({ latitude: -14.59, longitude: 175.42 }),
      destination: Object.freeze({ latitude: -14.50, longitude: 175.64 }),
      description: 'A curated regional exploration near Spirit; not an official rover traverse.',
      mode: 'cinematic', clearanceM: 4200,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    }),
    Object.freeze({
      id: 'meridiani', name: 'Meridiani Planum', region: 'Meridiani Planum',
      regionId: 'meridiani-opportunity',
      start: Object.freeze({ latitude: -1.97, longitude: -5.58 }),
      destination: Object.freeze({ latitude: -1.88, longitude: -5.37 }),
      description: 'A curated regional exploration near Opportunity’s landing site; not a rover traverse.',
      mode: 'follow', clearanceM: 2400,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    }),
    Object.freeze({
      id: 'olympus', name: 'Olympus Mons', region: 'Tharsis',
      regionId: 'olympus-mons',
      start: Object.freeze({ latitude: 18.58, longitude: -133.95 }),
      destination: Object.freeze({ latitude: 18.72, longitude: -133.65 }),
      description: 'A curated local exploration on Olympus Mons; not a mission traverse.',
      mode: 'overview', clearanceM: 18000,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    }),
    Object.freeze({
      id: 'valles', name: 'Valles Marineris', region: 'Valles Marineris',
      regionId: 'valles-marineris',
      start: Object.freeze({ latitude: -8.50, longitude: -70.15 }),
      destination: Object.freeze({ latitude: -8.50, longitude: -69.85 }),
      description: 'A curated local exploration within Valles Marineris; not a mission traverse.',
      mode: 'overview', clearanceM: 18000,
      source: 'Bundled NASA MOLA MEGDR 128 pixels/degree',
      limitation: 'The 463 m nominal cells are not rover-scale or flight-safety terrain.'
    })
  ]);

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function radians(degrees) { return degrees * Math.PI / 180; }
  function degrees(value) { return value * 180 / Math.PI; }
  function wrapLongitude(longitude) { return ((longitude + 180) % 360 + 360) % 360 - 180; }

  function validatePoint(point, label) {
    if (!point || !finite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
        !finite(point.longitude) || point.longitude < -360 || point.longitude > 360) {
      throw new RangeError(`${label} must have a finite latitude from -90° to 90° and east-positive longitude from -360° to 360°.`);
    }
    return { latitude: point.latitude, longitude: wrapLongitude(point.longitude) };
  }

  function distanceMeters(a, b) {
    const lat1 = radians(a.latitude), lat2 = radians(b.latitude);
    const deltaLat = lat2 - lat1;
    const deltaLon = radians(wrapLongitude(b.longitude - a.longitude));
    const haversine = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * MARS_MEAN_RADIUS_M * Math.atan2(Math.sqrt(Math.min(1, haversine)),
      Math.sqrt(Math.max(0, 1 - haversine)));
  }

  function interpolateGreatCircle(a, b, fraction) {
    const vector = point => {
      const lat = radians(point.latitude), lon = radians(point.longitude);
      return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    };
    const start = vector(a), end = vector(b);
    const dot = Math.max(-1, Math.min(1, start.reduce((sum, value, index) => sum + value * end[index], 0)));
    const angle = Math.acos(dot);
    if (angle < 1e-12) return { latitude: a.latitude, longitude: a.longitude };
    if (Math.PI - angle < 1e-8) throw new RangeError('Routes near antipodal points are ambiguous; choose a different endpoint.');
    const denominator = Math.sin(angle);
    const left = Math.sin((1 - fraction) * angle) / denominator;
    const right = Math.sin(fraction * angle) / denominator;
    const result = start.map((value, index) => value * left + end[index] * right);
    return {
      latitude: degrees(Math.atan2(result[2], Math.hypot(result[0], result[1]))),
      longitude: degrees(Math.atan2(result[1], result[0]))
    };
  }

  function bearingBetween(a, b) {
    const lat1 = radians(a.latitude), lat2 = radians(b.latitude);
    const deltaLon = radians(wrapLongitude(b.longitude - a.longitude));
    return Math.atan2(Math.sin(deltaLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon));
  }

  function destinationPoint(origin, bearing, distance) {
    const angularDistance = distance / MARS_MEAN_RADIUS_M;
    const lat1 = radians(origin.latitude), lon1 = radians(origin.longitude);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
    return { latitude: degrees(lat2), longitude: wrapLongitude(degrees(lon2)) };
  }

  function terrainHeightAboveEllipsoid(sample) {
    if (!sample?.valid || !finite(sample.radialRadiusM) || !finite(sample.planetocentricLatitude)) {
      throw new Error('The MOLA terrain sample is unavailable.');
    }
    const latitude = radians(sample.planetocentricLatitude);
    const equatorial = 3396190, polar = 3376200;
    const ellipsoidRadius = 1 / Math.sqrt(Math.cos(latitude) ** 2 / equatorial ** 2 +
      Math.sin(latitude) ** 2 / polar ** 2);
    return sample.radialRadiusM - ellipsoidRadius;
  }

  function smoothPath(path, amount) {
    if (path.length < 3 || amount <= 0) return path;
    const result = path.map(point => ({ ...point }));
    for (let index = 1; index < path.length - 1; index++) {
      const previous = path[index - 1], current = path[index], next = path[index + 1];
      const previousLon = current.longitude + wrapLongitude(previous.longitude - current.longitude);
      const nextLon = current.longitude + wrapLongitude(next.longitude - current.longitude);
      result[index] = {
        latitude: current.latitude * (1 - amount) + (previous.latitude + next.latitude) * amount / 2,
        longitude: wrapLongitude(current.longitude * (1 - amount) + (previousLon + nextLon) * amount / 2)
      };
    }
    return result;
  }

  function normalizeVector(vector) {
    if (!Array.isArray(vector) || vector.length !== 3 || vector.some(value => !finite(value))) {
      throw new TypeError('A finite 3D vector is required.');
    }
    const magnitude = Math.hypot(...vector);
    if (!Number.isFinite(magnitude) || magnitude < 1e-12) {
      throw new RangeError('A non-zero 3D vector is required.');
    }
    return vector.map(component => component / magnitude);
  }

  function crossProduct(a, b) {
    if (!Array.isArray(a) || a.length !== 3 || !Array.isArray(b) || b.length !== 3 ||
        a.some(value => !finite(value)) || b.some(value => !finite(value))) {
      throw new TypeError('Two finite 3D vectors are required for a cross product.');
    }
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function computeCameraBasis(direction) {
    let vector;
    if (Array.isArray(direction)) vector = direction;
    else if (direction && typeof direction === 'object') vector = [direction.x ?? 0, direction.y ?? 0, direction.z ?? 0];
    else vector = null;
    if (!Array.isArray(vector) || vector.length !== 3 || vector.some(value => !finite(value))) {
      throw new TypeError('A 3D camera direction is required.');
    }
    const directionVector = normalizeVector(vector);
    const reference = Math.abs(directionVector[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
    const rightVector = normalizeVector(crossProduct(reference, directionVector));
    const upVector = normalizeVector(crossProduct(directionVector, rightVector));
    return {
      direction: directionVector,
      right: rightVector,
      up: upVector
    };
  }

  function scienceLatitude(latitude) {
    const latitudeRadians = radians(latitude);
    return Math.atan((3376200 ** 2 / 3396190 ** 2) * Math.tan(latitudeRadians)) * 180 / Math.PI;
  }

  function resamplePath(path, maxSpacingKm) {
    const samples = [];
    let distanceAlongM = 0;
    for (let segment = 0; segment < path.length - 1; segment++) {
      const a = path[segment], b = path[segment + 1];
      const length = distanceMeters(a, b);
      const midpoint = interpolateGreatCircle(a, b, 0.5);
      const maxLatitude = scienceLatitude(Math.max(
        Math.abs(a.latitude), Math.abs(b.latitude), Math.abs(midpoint.latitude)
      ));
      const eastWestSpacingKm = 14.818 * Math.max(0, Math.cos(radians(maxLatitude)));
      const verificationSpacingM = Math.min(maxSpacingKm * 1000 / 3,
        Math.max(100, eastWestSpacingKm * 500));
      const count = Math.max(1, Math.ceil(length / verificationSpacingM));
      for (let step = segment === 0 ? 0 : 1; step <= count; step++) {
        const point = interpolateGreatCircle(a, b, step / count);
        if (samples.length) distanceAlongM += distanceMeters(samples[samples.length - 1], point);
        samples.push({ ...point, distanceKm: distanceAlongM / 1000 });
        if (samples.length > 5000) {
          throw new RangeError('This route exceeds the 5,000 terrain-sample limit at the local MOLA grid spacing.');
        }
      }
    }
    if (path.length === 1) samples.push({ ...path[0], distanceKm: 0 });
    return samples;
  }

  function planRoute(grid, science, inputStart, inputDestination, preferences = {}) {
    if (!grid?.topography || !grid?.areoid || !science || typeof science.sampleElevation !== 'function') {
      throw new TypeError('A decoded NASA MOLA grid and terrain sampler are required.');
    }
    const start = validatePoint(inputStart, 'Start point');
    const destination = validatePoint(inputDestination, 'Destination');
    const directDistanceM = distanceMeters(start, destination);
    if (directDistanceM < 1) throw new RangeError('Choose two distinct locations at least one metre apart.');
    if (directDistanceM > 20000000) throw new RangeError('Routes longer than 20,000 km are not supported by this regional corridor planner.');
    interpolateGreatCircle(start, destination, 0.5);

    const mode = MODES[preferences.mode] ? preferences.mode : 'cinematic';
    const defaults = MODES[mode];
    const clearanceM = preferences.clearanceM ?? defaults.clearanceM;
    const maxHeightM = preferences.maxHeightM ?? defaults.maxHeightM;
    const smoothness = preferences.smoothness ?? defaults.smoothness;
    const sampleSpacingKm = preferences.sampleSpacingKm ?? GRID_STEP_KM;
    if (!finite(clearanceM) || clearanceM < 500 || clearanceM > 40000) {
      throw new RangeError('Minimum terrain clearance must be between 500 m and 40,000 m.');
    }
    if (!finite(maxHeightM) || maxHeightM < 10000 || maxHeightM > 200000) {
      throw new RangeError('Maximum visualization altitude must be between 10 km and 200 km above the reference ellipsoid.');
    }
    if (!finite(smoothness) || smoothness < 0 || smoothness > 0.8) {
      throw new RangeError('Route smoothness must be between 0 and 0.8.');
    }
    if (!finite(sampleSpacingKm) || sampleSpacingKm < 0.5 || sampleSpacingKm > 15) {
      throw new RangeError('Route candidate spacing must be between 0.5 and 15 km.');
    }

    const stationCount = Math.max(2, Math.ceil(directDistanceM / (sampleSpacingKm * 1000)));
    if (stationCount * OFFSETS.length > 12000) {
      throw new RangeError('This route needs too many terrain candidates. Shorten it or increase sample spacing.');
    }
    const offsets = OFFSETS.map(value => value * sampleSpacingKm * 1000);
    const stations = [];
    for (let index = 0; index <= stationCount; index++) {
      const fraction = index / stationCount;
      const center = interpolateGreatCircle(start, destination, fraction);
      const before = interpolateGreatCircle(start, destination, Math.max(0, fraction - 0.001));
      const after = interpolateGreatCircle(start, destination, Math.min(1, fraction + 0.001));
      const bearing = bearingBetween(before, after);
      const candidates = index === 0 ? [start] : index === stationCount ? [destination] : offsets.map((offset) =>
        destinationPoint(center, bearing + Math.PI / 2, offset));
      stations.push(candidates.map((point) => {
        const terrain = science.sampleElevation(grid, point.latitude, point.longitude);
        return {
          ...point,
          terrain,
          terrainHeightM: terrain?.valid ? terrainHeightAboveEllipsoid(terrain) : Infinity,
          crossTrackM: index === 0 || index === stationCount ? 0 : distanceMeters(center, point)
        };
      }));
    }

    const startTerrain = science.sampleElevation(grid, start.latitude, start.longitude);
    const destinationTerrain = science.sampleElevation(grid, destination.latitude, destination.longitude);
    if (!startTerrain?.valid || !destinationTerrain?.valid) {
      throw new RangeError('The regional terrain sample is unavailable at an endpoint. Both endpoints must be inside the selected DEM coverage.');
    }
    const startHeight = terrainHeightAboveEllipsoid(startTerrain);
    const destinationHeight = terrainHeightAboveEllipsoid(destinationTerrain);

    // Layered dynamic programming searches a five-lane geodesic corridor.
    // The cost is distance + 1.5× absolute terrain change + a mode-weighted
    // elevation above the endpoint trend + 0.18× lateral deviation, in km.
    const obstacleWeight = preferences.obstacleWeight ?? defaults.obstacleWeight;
    if (!finite(obstacleWeight) || obstacleWeight < 0 || obstacleWeight > 50) {
      throw new RangeError('Terrain corridor preference must be between 0 and 50.');
    }
    const costs = [stations[0].map(() => 0)];
    const parents = [];
    for (let layer = 1; layer < stations.length; layer++) {
      const currentCosts = stations[layer].map(() => Infinity);
      const currentParents = stations[layer].map(() => -1);
      for (let currentIndex = 0; currentIndex < stations[layer].length; currentIndex++) {
        const current = stations[layer][currentIndex];
        if (!Number.isFinite(current.terrainHeightM)) continue;
        for (let previousIndex = 0; previousIndex < stations[layer - 1].length; previousIndex++) {
          if (!Number.isFinite(costs[layer - 1][previousIndex])) continue;
          const previous = stations[layer - 1][previousIndex];
          const segmentKm = distanceMeters(previous, current) / 1000;
          const terrainChangeKm = Math.abs(current.terrainHeightM - previous.terrainHeightM) / 1000;
          const routeFraction = layer / stationCount;
          const endpointTrendM = startHeight + (destinationHeight - startHeight) * routeFraction;
          const obstacleKm = Math.max(0, current.terrainHeightM - endpointTrendM) / 1000;
          const deviationKm = current.crossTrackM / 1000;
          const candidateCost = costs[layer - 1][previousIndex] + segmentKm +
            terrainChangeKm * 1.5 + obstacleKm * obstacleWeight + deviationKm * 0.18;
          if (candidateCost < currentCosts[currentIndex]) {
            currentCosts[currentIndex] = candidateCost;
            currentParents[currentIndex] = previousIndex;
          }
        }
      }
      costs.push(currentCosts);
      parents.push(currentParents);
    }

    const finalIndex = 0;
    if (!Number.isFinite(costs.at(-1)[finalIndex])) {
      throw new Error('No terrain-aware path could be planned through the sampled MOLA grid.');
    }
    const chosen = new Array(stations.length);
    let candidateIndex = finalIndex;
    for (let layer = stations.length - 1; layer >= 0; layer--) {
      chosen[layer] = stations[layer][candidateIndex];
      if (layer > 0) candidateIndex = parents[layer - 1][candidateIndex];
    }
    const optimizedPath = smoothPath(chosen.map(point => ({
      latitude: point.latitude, longitude: point.longitude
    })), smoothness);
    optimizedPath[0] = start;
    optimizedPath[optimizedPath.length - 1] = destination;
    const trajectory = resamplePath(optimizedPath, sampleSpacingKm);
    let maximumTerrainElevationM = -Infinity;
    for (const point of trajectory) {
      point.terrain = science.sampleElevation(grid, point.latitude, point.longitude);
      if (!point.terrain?.valid) {
        throw new RangeError('The selected route leaves the regional DEM coverage. Shorten it or choose another patch.');
      }
      point.terrainHeightM = terrainHeightAboveEllipsoid(point.terrain);
      maximumTerrainElevationM = Math.max(maximumTerrainElevationM, point.terrain.elevationM);
    }
    const requiredHeights = trajectory.map(point => point.terrainHeightM + clearanceM);
    let flightHeights = requiredHeights.slice();
    const smoothingPasses = Math.round(smoothness * 4);
    for (let pass = 0; pass < smoothingPasses; pass++) {
      flightHeights = flightHeights.map((height, index, values) => {
        if (index === 0 || index === values.length - 1) return height;
        const average = (values[index - 1] + values[index + 1]) / 2;
        return Math.max(requiredHeights[index], height * (1 - smoothness) + average * smoothness);
      });
    }
    trajectory.forEach((point, index) => { point.flightHeightM = flightHeights[index]; });
    const midpointChecks = [];
    for (let pass = 0; pass < 3; pass++) {
      midpointChecks.length = 0;
      let corrected = false;
      for (let index = 0; index < trajectory.length - 1; index++) {
        const first = trajectory[index], second = trajectory[index + 1];
        const position = interpolateGreatCircle(first, second, 0.5);
        const terrain = science.sampleElevation(grid, position.latitude, position.longitude);
        if (!terrain?.valid) {
          throw new RangeError('The route segment leaves the regional DEM coverage. Choose endpoints and a corridor wholly inside the selected patch.');
        }
        const terrainHeightM = terrainHeightAboveEllipsoid(terrain);
        maximumTerrainElevationM = Math.max(maximumTerrainElevationM, terrain.elevationM);
        const flightHeightM = (first.flightHeightM + second.flightHeightM) / 2;
        const clearanceAtMidpointM = flightHeightM - terrainHeightM;
        midpointChecks.push({ terrain, terrainHeightM, clearanceM: clearanceAtMidpointM });
        if (clearanceAtMidpointM < clearanceM) {
          const correction = clearanceM - clearanceAtMidpointM + 1;
          first.flightHeightM += correction;
          second.flightHeightM += correction;
          corrected = true;
        }
      }
      if (!corrected) break;
    }
    midpointChecks.length = 0;
    for (let index = 0; index < trajectory.length - 1; index++) {
      const first = trajectory[index], second = trajectory[index + 1];
      const position = interpolateGreatCircle(first, second, 0.5);
      const terrain = science.sampleElevation(grid, position.latitude, position.longitude);
      if (!terrain?.valid) {
        throw new RangeError('The route segment leaves the regional DEM coverage. Choose endpoints and a corridor wholly inside the selected patch.');
      }
      const terrainHeightM = terrainHeightAboveEllipsoid(terrain);
      maximumTerrainElevationM = Math.max(maximumTerrainElevationM, terrain.elevationM);
      midpointChecks.push({
        terrain, terrainHeightM,
        clearanceM: (first.flightHeightM + second.flightHeightM) / 2 - terrainHeightM
      });
    }

    let maximumFlightElevationM = -Infinity;
    let minimumClearanceM = Infinity;
    let ascentM = 0, descentM = 0, previousHeightM = null;
    for (const [index, point] of trajectory.entries()) {
      maximumFlightElevationM = Math.max(maximumFlightElevationM, point.flightHeightM);
      point.clearanceM = point.flightHeightM - point.terrainHeightM;
      minimumClearanceM = Math.min(minimumClearanceM, point.clearanceM);
      if (previousHeightM !== null) {
        const change = point.flightHeightM - previousHeightM;
        if (change > 0) ascentM += change;
        else descentM -= change;
      }
      previousHeightM = point.flightHeightM;
    }
    for (const check of midpointChecks) {
      maximumFlightElevationM = Math.max(maximumFlightElevationM,
        check.clearanceM + check.terrainHeightM);
      minimumClearanceM = Math.min(minimumClearanceM, check.clearanceM);
    }
    if (maximumFlightElevationM > maxHeightM) {
      throw new Error(`The route requires ${(maximumFlightElevationM / 1000).toFixed(1)} km altitude, above the selected ${(maxHeightM / 1000).toFixed(0)} km limit. Choose a higher limit or another flight mode.`);
    }
    if (trajectory.some(point => !point.terrain.valid || point.clearanceM < clearanceM - 0.01) ||
        midpointChecks.some(check => !check.terrain.valid || check.clearanceM < clearanceM - 0.01)) {
      throw new Error('Terrain clearance could not be verified along the planned trajectory.');
    }
    const routeDistanceKm = trajectory.at(-1).distanceKm;
    const maximumDeviationKm = Math.max(...chosen.map(point => point.crossTrackM)) / 1000;
    return {
      start, destination, mode, modeLabel: defaults.label, trajectory,
      directDistanceKm: directDistanceM / 1000,
      routeDistanceKm,
      durationSeconds: Math.max(8, routeDistanceKm / 2.5),
      maximumTerrainElevationM,
      maximumFlightElevationM,
      minimumClearanceM,
      ascentM, descentM, maximumDeviationKm,
      dataset: preferences.dataset || science.MOLA_SOURCE,
      sampleCount: trajectory.length,
      costFunction: `distance + 1.5× absolute terrain change + ${obstacleWeight}× elevation above the endpoint trend + 0.18× lateral deviation (all terms in km)`,
      limitations: science.MOLA_SOURCE.limitations
    };
  }

  function sampleTrajectory(trajectory, fraction) {
    if (!Array.isArray(trajectory) || trajectory.length < 2) throw new TypeError('A planned trajectory is required.');
    if (!finite(fraction)) throw new TypeError('Progress must be finite.');
    const progress = Math.max(0, Math.min(1, fraction));
    const targetDistanceKm = trajectory.at(-1).distanceKm * progress;
    let low = 0, high = trajectory.length - 1;
    while (low < high - 1) {
      const middle = Math.floor((low + high) / 2);
      if (trajectory[middle].distanceKm <= targetDistanceKm) low = middle;
      else high = middle;
    }
    const index = Math.min(trajectory.length - 2, low);
    const a = trajectory[index], b = trajectory[index + 1];
    const segmentDistanceKm = b.distanceKm - a.distanceKm;
    const segmentFraction = segmentDistanceKm > 0
      ? Math.max(0, Math.min(1, (targetDistanceKm - a.distanceKm) / segmentDistanceKm)) : 0;
    const point = interpolateGreatCircle(a, b, segmentFraction);
    return {
      ...point,
      index,
      distanceKm: targetDistanceKm,
      flightHeightM: a.flightHeightM + (b.flightHeightM - a.flightHeightM) * segmentFraction,
      terrainHeightM: a.terrainHeightM + (b.terrainHeightM - a.terrainHeightM) * segmentFraction,
      clearanceM: a.clearanceM + (b.clearanceM - a.clearanceM) * segmentFraction,
      terrain: segmentFraction < 0.5 ? a.terrain : b.terrain
    };
  }

  const api = Object.freeze({
    MODES, PRESETS, validatePoint, distanceMeters, interpolateGreatCircle,
    terrainHeightAboveEllipsoid, planRoute, sampleTrajectory, computeCameraBasis
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarsWalkPlanner = api;
})(typeof window === 'object' ? window : globalThis);
