(function (root) {
  'use strict';

  const MARS_MEAN_RADIUS_M = 3389500;
  const MOLA_RADIUS_M = 3396000;
  const GRID = Object.freeze({ width: 1440, height: 720, degreesPerPixel: 0.25 });
  const MOLA_SOURCE = Object.freeze({
    id: 'mgs-mola-megdr-4ppd-v2',
    title: 'MOLA Mission Experiment Gridded Data Record, 4 pixels/degree',
    datasetId: 'MGS-M-MOLA-5-MEGDR-L3-V1.0',
    version: '2.0',
    institution: 'NASA Goddard Space Flight Center · MOLA Science Team',
    landingPage: 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
    topographyUrl: 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img',
    areoidUrl: 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/mega90n000cb.img',
    resolutionKmAtEquator: 14.818,
    horizontalReference: 'IAU 2000; east-positive longitude; planetocentric latitude',
    verticalReference: 'GMM3 areoid (Goddard Mars gravity model mgm1025, degree/order 50)',
    coverage: 'Global; 90°S–90°N; 0°–360° east longitude',
    dataType: '1440 × 720 signed 16-bit big-endian integer rasters; metres',
    lastCheckedAt: '2026-10-16',
    access: 'Publicly archived NASA PDS data; cite and attribute the NASA MOLA Science Team and PDS Geosciences Node.',
    attribution: 'NASA / MOLA Science Team / PDS Geosciences Node',
    limitations: '0.25° global grid. The source fills cells without direct observations by interpolation; this is not local rover-scale terrain.'
  });

  const NASA_TIMELINE_SOURCE = 'https://science.nasa.gov/planetary-science/programs/mars-exploration/mission-timeline/';
  const missions = Object.freeze([
    { id: 'viking-1', name: 'Viking 1', type: 'Lander', operator: 'NASA', launchDate: '1975-08-20', landingDate: '1976-07-20', status: 'Mission ended', statusDate: '1982-11-13', lastOperationalDate: '1982-11-13', endDate: '1982-11-13', landingSite: 'Chryse Planitia', latitude: 22.48, longitude: -47.97, source: 'https://science.nasa.gov/mission/viking-1/', note: 'First successful U.S. Mars landing. The listed end date is the final communication date.' },
    { id: 'viking-2', name: 'Viking 2', type: 'Lander', operator: 'NASA', launchDate: '1975-09-09', landingDate: '1976-09-03', status: 'Mission ended', statusDate: '1980-04-11', lastOperationalDate: '1980-04-11', endDate: '1980-04-11', landingSite: 'Utopia Planitia', latitude: 47.64, longitude: -134.28, source: NASA_TIMELINE_SOURCE, note: 'The Viking 2 lander operated at Utopia Planitia; the date shown is its last communication.' },
    { id: 'pathfinder', name: 'Mars Pathfinder · Sojourner', type: 'Lander / rover', operator: 'NASA', launchDate: '1996-12-04', landingDate: '1997-07-04', status: 'Mission ended', statusDate: '1997-09-27', lastOperationalDate: '1997-09-27', endDate: '1997-09-27', landingSite: 'Ares Vallis', latitude: 19.13, longitude: -33.22, source: 'https://science.nasa.gov/mission/mars-pathfinder/', note: 'NASA reports the final Pathfinder data transmission on 27 September 1997.' },
    { id: 'mars-polar-lander', name: 'Mars Polar Lander', type: 'Lander', operator: 'NASA', launchDate: '1999-01-03', landingDate: '1999-12-03', status: 'Landing unsuccessful', statusDate: '1999-12-03', lastOperationalDate: null, endDate: '1999-12-03', landingSite: 'Targeted south polar region · landing not confirmed', latitude: null, longitude: null, source: NASA_TIMELINE_SOURCE, note: 'Contact was lost during the landing sequence. No landing coordinate is known or shown.' },
    { id: 'spirit', name: 'Spirit', type: 'Rover', operator: 'NASA', launchDate: '2003-06-10', landingDate: '2004-01-04', status: 'Mission ended', statusDate: '2011-05-25', lastOperationalDate: '2010-03-22', endDate: '2011-05-25', landingSite: 'Gusev Crater', latitude: -14.5684, longitude: 175.4726, source: NASA_TIMELINE_SOURCE, note: 'Last communication and formal end-of-mission dates differ; NASA ended recovery efforts in 2011.' },
    { id: 'opportunity', name: 'Opportunity', type: 'Rover', operator: 'NASA', launchDate: '2003-07-07', landingDate: '2004-01-25', status: 'Mission ended', statusDate: '2019-02-13', lastOperationalDate: '2018-06-10', endDate: '2019-02-13', landingSite: 'Eagle Crater · Meridiani Planum', latitude: -1.95, longitude: -5.53, source: 'https://science.nasa.gov/resource/rovers-landing-hardware-at-eagle-crater-mars/', note: 'Last contact was in June 2018; NASA formally ended the mission in February 2019.' },
    { id: 'phoenix', name: 'Phoenix', type: 'Lander', operator: 'NASA', launchDate: '2007-08-04', landingDate: '2008-05-25', status: 'Mission ended', statusDate: '2008-11-02', lastOperationalDate: '2008-11-02', endDate: '2008-11-02', landingSite: 'Green Valley · Vastitas Borealis', latitude: 68.22, longitude: -125.75, source: NASA_TIMELINE_SOURCE, note: 'The lander ceased communicating as seasonal darkness and cold increased.' },
    { id: 'curiosity', name: 'Curiosity', type: 'Rover', operator: 'NASA', launchDate: '2011-11-26', landingDate: '2012-08-06', status: 'Operational', statusDate: '2026-10-16', lastOperationalDate: null, endDate: null, landingSite: 'Gale Crater', latitude: -4.5895, longitude: 137.4417, source: 'https://science.nasa.gov/mission/msl-curiosity/', note: 'Mission metadata are a locally curated record. Operational status is not a live telemetry feed.' },
    { id: 'insight', name: 'InSight', type: 'Lander', operator: 'NASA', launchDate: '2018-05-05', landingDate: '2018-11-26', status: 'Mission ended', statusDate: '2022-12-21', lastOperationalDate: '2022-12-15', endDate: '2022-12-21', landingSite: 'Elysium Planitia', latitude: 4.5024, longitude: 135.6234, source: 'https://science.nasa.gov/mission/insight/', note: 'NASA declared the mission ended after repeated missed communications; this does not establish a physical cause of failure.' },
    { id: 'perseverance', name: 'Perseverance', type: 'Rover', operator: 'NASA', launchDate: '2020-07-30', landingDate: '2021-02-18', status: 'Operational', statusDate: '2026-10-16', lastOperationalDate: null, endDate: null, landingSite: 'Jezero Crater', latitude: 18.4447, longitude: 77.4508, source: 'https://science.nasa.gov/mission/mars-2020-perseverance/', note: 'NASA’s mission page describes continued surface operations. No live rover position is bundled by this app.' }
  ]);

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function normalizeLongitude(longitude) {
    if (!finite(longitude)) throw new TypeError('Longitude must be a finite number.');
    return ((longitude % 360) + 360) % 360;
  }

  function validateCoordinate(latitude, longitude) {
    if (!finite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('Latitude must be between -90° and 90°.');
    if (!finite(longitude) || longitude < -360 || longitude > 360) throw new RangeError('Longitude must be between -360° and 360°.');
    return { latitude, longitude: normalizeLongitude(longitude) };
  }

  function planetographicToPlanetocentric(latitudeDegrees, equatorialRadius = 3396190, polarRadius = 3376200) {
    if (!finite(latitudeDegrees) || latitudeDegrees < -90 || latitudeDegrees > 90) throw new RangeError('Latitude must be between -90° and 90°.');
    const latitude = latitudeDegrees * Math.PI / 180;
    if (Math.abs(latitudeDegrees) === 90) return latitudeDegrees;
    return Math.atan((polarRadius ** 2 / equatorialRadius ** 2) * Math.tan(latitude)) * 180 / Math.PI;
  }

  function planetocentricToPlanetographic(latitudeDegrees, equatorialRadius = 3396190, polarRadius = 3376200) {
    if (!finite(latitudeDegrees) || latitudeDegrees < -90 || latitudeDegrees > 90) throw new RangeError('Latitude must be between -90° and 90°.');
    const latitude = latitudeDegrees * Math.PI / 180;
    if (Math.abs(latitudeDegrees) === 90) return latitudeDegrees;
    return Math.atan((equatorialRadius ** 2 / polarRadius ** 2) * Math.tan(latitude)) * 180 / Math.PI;
  }

  function dataViewOf(input) {
    if (input instanceof ArrayBuffer) return new DataView(input);
    if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError('Raster data must be an ArrayBuffer or typed-array view.');
  }

  function decodeMola(topographyInput, areoidInput) {
    const topography = dataViewOf(topographyInput);
    const areoid = dataViewOf(areoidInput);
    const expectedBytes = GRID.width * GRID.height * 2;
    if (topography.byteLength !== expectedBytes || areoid.byteLength !== expectedBytes) {
      throw new RangeError(`MOLA rasters must each contain exactly ${expectedBytes} bytes.`);
    }
    return Object.freeze({ topography, areoid, grid: GRID, source: MOLA_SOURCE });
  }

  function rawCell(grid, row, column) {
    const wrappedColumn = ((column % GRID.width) + GRID.width) % GRID.width;
    const boundedRow = Math.max(0, Math.min(GRID.height - 1, row));
    const offset = (boundedRow * GRID.width + wrappedColumn) * 2;
    const topography = grid.topography.getInt16(offset, false);
    const areoidOffset = grid.areoid.getInt16(offset, false);
    return {
      elevationM: topography,
      areoidRadiusM: MOLA_RADIUS_M + areoidOffset,
      radialRadiusM: MOLA_RADIUS_M + areoidOffset + topography
    };
  }

  function gridPosition(latitude, longitude) {
    const point = validateCoordinate(latitude, longitude);
    const planetocentricLatitude = planetographicToPlanetocentric(point.latitude);
    const row = (90 - planetocentricLatitude) / GRID.degreesPerPixel - 0.5;
    const column = normalizeLongitude(point.longitude) / GRID.degreesPerPixel - 0.5;
    return { row, column, planetocentricLatitude, longitude: point.longitude };
  }

  function sampleElevation(grid, latitude, longitude, method = 'bilinear') {
    if (!grid?.topography || !grid?.areoid || !['nearest', 'bilinear'].includes(method)) {
      throw new TypeError('A decoded MOLA grid and supported sampling method are required.');
    }
    const position = gridPosition(latitude, longitude);
    const northSouthKm = MARS_MEAN_RADIUS_M * GRID.degreesPerPixel * Math.PI / 180 / 1000;
    const eastWestKm = northSouthKm * Math.max(0, Math.cos(position.planetocentricLatitude * Math.PI / 180));
    let sample;
    if (method === 'nearest') {
      sample = rawCell(grid, Math.round(position.row), Math.round(position.column));
    } else {
      const row0 = Math.floor(position.row), column0 = Math.floor(position.column);
      const rowFraction = position.row - row0, columnFraction = position.column - column0;
      const cells = [
        [rawCell(grid, row0, column0), (1 - rowFraction) * (1 - columnFraction)],
        [rawCell(grid, row0, column0 + 1), (1 - rowFraction) * columnFraction],
        [rawCell(grid, row0 + 1, column0), rowFraction * (1 - columnFraction)],
        [rawCell(grid, row0 + 1, column0 + 1), rowFraction * columnFraction]
      ];
      sample = {
        elevationM: cells.reduce((sum, [cell, weight]) => sum + cell.elevationM * weight, 0),
        areoidRadiusM: cells.reduce((sum, [cell, weight]) => sum + cell.areoidRadiusM * weight, 0),
        radialRadiusM: cells.reduce((sum, [cell, weight]) => sum + cell.radialRadiusM * weight, 0)
      };
    }
    return {
      latitude: latitude,
      longitude: position.longitude,
      planetocentricLatitude: position.planetocentricLatitude,
      elevationM: sample.elevationM,
      areoidRadiusM: sample.areoidRadiusM,
      radialRadiusM: sample.radialRadiusM,
      units: 'm',
      valid: true,
      noData: false,
      dataset: MOLA_SOURCE.id,
      datasetVersion: MOLA_SOURCE.version,
      resolutionKmAtEquator: MOLA_SOURCE.resolutionKmAtEquator,
      effectiveGridSpacingKm: { northSouth: northSouthKm, eastWest: eastWestKm },
      horizontalReference: MOLA_SOURCE.horizontalReference,
      verticalReference: MOLA_SOURCE.verticalReference,
      sourceUrl: MOLA_SOURCE.landingPage,
      samplingMethod: method,
      valueType: 'source-grid sample; direct-observation versus archive-filled status is not distinguished without the counts product',
      uncertainty: null,
      retrievedAt: null,
      cacheStatus: 'Decoded grid supplied by caller; cache state is managed by the application.',
      qualityNote: MOLA_SOURCE.limitations
    };
  }

  function angularDistance(a, b) {
    const lat1 = a.latitude * Math.PI / 180, lat2 = b.latitude * Math.PI / 180;
    const deltaLat = lat2 - lat1;
    const deltaLonDegrees = ((b.longitude - a.longitude + 540) % 360) - 180;
    const deltaLon = deltaLonDegrees * Math.PI / 180;
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
  }

  function interpolateGreatCircle(a, b, fraction) {
    const toVector = point => {
      const latitude = point.latitude * Math.PI / 180;
      const longitude = point.longitude * Math.PI / 180;
      return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
    };
    const start = toVector(a), end = toVector(b);
    const dot = Math.max(-1, Math.min(1, start.reduce((sum, value, index) => sum + value * end[index], 0)));
    const omega = Math.acos(dot);
    if (omega < 1e-12) return { latitude: a.latitude, longitude: a.longitude };
    if (Math.PI - omega < 1e-8) throw new RangeError('A route segment near antipodal points cannot be interpolated unambiguously.');
    const denominator = Math.sin(omega);
    const left = Math.sin((1 - fraction) * omega) / denominator;
    const right = Math.sin(fraction * omega) / denominator;
    const vector = start.map((value, index) => value * left + end[index] * right);
    return {
      latitude: Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) * 180 / Math.PI,
      longitude: Math.atan2(vector[1], vector[0]) * 180 / Math.PI
    };
  }

  function routeDistanceMeters(a, b) {
    return angularDistance(a, b) * MARS_MEAN_RADIUS_M;
  }

  function calculateLocalSlope(grid, latitude, longitude) {
    const position = gridPosition(latitude, longitude);
    const row = Math.round(position.row), column = Math.round(position.column);
    const north = rawCell(grid, row - 1, column).elevationM;
    const south = rawCell(grid, row + 1, column).elevationM;
    const east = rawCell(grid, row, column + 1).elevationM;
    const west = rawCell(grid, row, column - 1).elevationM;
    const spacing = GRID.degreesPerPixel * Math.PI / 180;
    const dx = 2 * MARS_MEAN_RADIUS_M * Math.max(1e-8, Math.cos(position.planetocentricLatitude * Math.PI / 180)) * spacing;
    const dy = 2 * MARS_MEAN_RADIUS_M * spacing;
    const dzdx = (east - west) / dx;
    const dzdy = (south - north) / dy;
    const gradient = Math.hypot(dzdx, dzdy);
    const degrees = Math.atan(gradient) * 180 / Math.PI;
    return {
      degrees,
      percent: gradient * 100,
      windowKm: { eastWest: dx / 1000, northSouth: dy / 1000 },
      resolutionKmAtEquator: MOLA_SOURCE.resolutionKmAtEquator,
      method: 'central finite differences over adjacent MOLA grid cells; spherical local-distance approximation',
      dataset: MOLA_SOURCE.id,
      datasetVersion: MOLA_SOURCE.version,
      sourceUrl: MOLA_SOURCE.landingPage,
      units: { slope: 'degrees', grade: 'percent' },
      valid: Number.isFinite(degrees) && Math.abs(latitude) < 89.9
    };
  }

  function sampleRoute(grid, inputPoints, spacingKm = 30) {
    if (!Array.isArray(inputPoints) || inputPoints.length < 1 || inputPoints.length > 500) {
      throw new RangeError('A route must contain between 1 and 500 waypoints.');
    }
    if (!finite(spacingKm) || spacingKm < 15 || spacingKm > 150) throw new RangeError('Sample spacing must be between 15 and 150 km.');
    const route = inputPoints.map(point => validateCoordinate(point.latitude, point.longitude));
    const distinct = route.filter((point, index) => index === 0 || routeDistanceMeters(route[index - 1], point) > 0.01);
    if (distinct.length === 0) throw new RangeError('The route contains no valid positions.');
    const estimatedSamples = distinct.length ? distinct.slice(1).reduce((count, point, index) =>
      count + Math.max(1, Math.ceil(routeDistanceMeters(distinct[index], point) / (spacingKm * 1000))), 1) : 0;
    if (estimatedSamples > 5000) throw new RangeError('This route would exceed the 5,000-sample analysis limit. Increase sample spacing or shorten the route.');
    const samples = [];
    let cumulativeMeters = 0;
    if (distinct.length === 1) {
      const point = distinct[0];
      samples.push({ index: 0, distanceKm: 0, latitude: point.latitude, longitude: point.longitude,
        terrain: sampleElevation(grid, point.latitude, point.longitude) });
    }
    for (let segment = 0; segment < distinct.length - 1; segment++) {
      const start = distinct[segment], end = distinct[segment + 1];
      const length = routeDistanceMeters(start, end);
      if (length < 0.01) continue;
      const count = Math.max(1, Math.ceil(length / (spacingKm * 1000)));
      for (let step = segment === 0 ? 0 : 1; step <= count; step++) {
        const fraction = step / count;
        const point = interpolateGreatCircle(start, end, fraction);
        const distanceKm = (cumulativeMeters + fraction * length) / 1000;
        samples.push({ index: samples.length, distanceKm, latitude: point.latitude, longitude: point.longitude,
          terrain: sampleElevation(grid, point.latitude, point.longitude) });
      }
      cumulativeMeters += length;
    }
    for (let index = 0; index < samples.length; index++) {
      const current = samples[index], previous = samples[index - 1];
      if (!previous || !previous.terrain.valid || !current.terrain.valid) {
        current.slopeDegrees = null;
        current.slopePercent = null;
      } else {
        const distance = (current.distanceKm - previous.distanceKm) * 1000;
        const grade = distance > 0 ? (current.terrain.elevationM - previous.terrain.elevationM) / distance : null;
        current.slopeDegrees = grade === null ? null : Math.atan(grade) * 180 / Math.PI;
        current.slopePercent = grade === null ? null : grade * 100;
      }
    }
    return {
      samples,
      totalDistanceKm: cumulativeMeters / 1000,
      source: MOLA_SOURCE,
      requestedSpacingKm: spacingKm,
      displayResolutionWarning: spacingKm < MOLA_SOURCE.resolutionKmAtEquator ||
        (samples.length > 1 && cumulativeMeters / 1000 < MOLA_SOURCE.resolutionKmAtEquator),
      routeType: 'User supplied'
    };
  }

  function importGeoJSON(input) {
    let document = input;
    if (typeof input === 'string') {
      try { document = JSON.parse(input); }
      catch { throw new TypeError('The selected file is not valid JSON.'); }
    }
    let geometry = document?.type === 'Feature' ? document.geometry : document;
    if (document?.type === 'FeatureCollection') {
      if (!Array.isArray(document.features) || document.features.length !== 1) throw new TypeError('Import exactly one GeoJSON route feature.');
      geometry = document.features[0]?.geometry;
    }
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
      throw new TypeError('GeoJSON must contain one LineString geometry.');
    }
    if (geometry.coordinates.length < 2 || geometry.coordinates.length > 500) throw new RangeError('Imported routes must contain 2 to 500 waypoints.');
    return geometry.coordinates.map((coordinate, index) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2 || coordinate.length > 3 ||
          !finite(coordinate[0]) || !finite(coordinate[1]) ||
          coordinate[0] < -180 || coordinate[0] > 180 ||
          coordinate[1] < -90 || coordinate[1] > 90 ||
          (coordinate.length === 3 && !finite(coordinate[2]))) {
        throw new RangeError(`Invalid GeoJSON coordinate at position ${index + 1}; expected [longitude, latitude, optional elevation].`);
      }
      return { latitude: coordinate[1], longitude: coordinate[0] };
    });
  }

  function validateMissions(records = missions) {
    if (!Array.isArray(records)) throw new TypeError('Mission records must be an array.');
    const ids = new Set();
    for (const mission of records) {
      if (!mission || typeof mission.id !== 'string' || ids.has(mission.id)) throw new TypeError('Mission IDs must be unique strings.');
      ids.add(mission.id);
      for (const field of ['launchDate', 'landingDate']) {
        if (mission[field] !== null && mission[field] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(mission[field])) {
          throw new TypeError(`Mission ${mission.id} has an invalid ${field}.`);
        }
      }
      if (mission.latitude !== null && mission.latitude !== undefined) validateCoordinate(mission.latitude, mission.longitude);
      if (!mission.source || !/^https:\/\//.test(mission.source)) throw new TypeError(`Mission ${mission.id} is missing a source URL.`);
      if ((mission.status === 'Operational') !== (mission.endDate == null)) throw new TypeError(`Mission ${mission.id} has inconsistent operational status and end date.`);
    }
    return true;
  }

  validateMissions();

  const api = Object.freeze({
    MARS_MEAN_RADIUS_M, MOLA_SOURCE, GRID, missions, NASA_TIMELINE_SOURCE,
    normalizeLongitude, validateCoordinate, planetographicToPlanetocentric,
    planetocentricToPlanetographic, decodeMola, sampleElevation, calculateLocalSlope,
    routeDistanceMeters, interpolateGreatCircle, sampleRoute, importGeoJSON, validateMissions
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarsScienceData = api;
})(typeof window === 'object' ? window : globalThis);
