(function (root) {
  'use strict';

  const SPEED_OPTIONS = Object.freeze([0.5, 1, 2, 4, 8]);
  const MIN_PITCH = 0.06;
  const MAX_PITCH = Math.PI / 2 - 0.01;

  function getZoomLimits(widthMeters, reliefMeters = 0) {
    if (!Number.isFinite(widthMeters) || widthMeters <= 0 ||
        !Number.isFinite(reliefMeters) || reliefMeters < 0) {
      throw new RangeError('Terrain width and relief must be finite positive distances.');
    }
    const minimum = Math.max(50, widthMeters * 0.008, reliefMeters * 1.25);
    const maximum = Math.max(widthMeters * 6, minimum * 4);
    return Object.freeze({ minimum, maximum, initial: Math.min(maximum, Math.max(minimum, widthMeters * 1.5)) });
  }

  function normalizeWheelDelta(event, viewportHeight = 800) {
    if (!event || !Number.isFinite(event.deltaY)) {
      throw new TypeError('A finite wheel delta is required for terrain zoom.');
    }
    const unit = event.deltaMode === 1 ? 16 :
      event.deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
    return event.deltaY * unit;
  }

  function zoomDistance(distance, deltaPixels, limits, sensitivity = 0.001) {
    if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(deltaPixels) ||
        !Number.isFinite(sensitivity) || sensitivity <= 0 ||
        !Number.isFinite(limits?.minimum) || !Number.isFinite(limits?.maximum) ||
        limits.minimum <= 0 || limits.maximum < limits.minimum) {
      throw new RangeError('Valid terrain zoom distance, delta, sensitivity, and limits are required.');
    }
    const logarithmicChange = Math.max(-0.25, Math.min(0.25, deltaPixels * sensitivity));
    return Math.max(limits.minimum, Math.min(limits.maximum, distance * Math.exp(logarithmicChange)));
  }

  function getOrbitAngles(focus, position) {
    if (![focus?.x, focus?.y, focus?.z, position?.x, position?.y, position?.z].every(Number.isFinite)) {
      throw new TypeError('Finite focus and camera positions are required to calculate orbit angles.');
    }
    const x = position.x - focus.x;
    const y = position.y - focus.y;
    const z = position.z - focus.z;
    const horizontalDistance = Math.hypot(x, y);
    const distance = Math.hypot(horizontalDistance, z);
    if (distance <= 0) throw new RangeError('The camera must be offset from its terrain focus.');
    return Object.freeze({
      yaw: Math.atan2(y, x),
      pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.atan2(z, horizontalDistance))),
      distance
    });
  }

  function orbitAngles(yaw, pitch, deltaX, deltaY, sensitivity = 0.006) {
    if (![yaw, pitch, deltaX, deltaY, sensitivity].every(Number.isFinite) || sensitivity <= 0) {
      throw new RangeError('Valid orbit angles, pointer movement, and sensitivity are required.');
    }
    return Object.freeze({
      yaw: yaw - deltaX * sensitivity,
      pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch + deltaY * sensitivity))
    });
  }

  function getScreenBasis(yaw, pitch) {
    if (![yaw, pitch].every(Number.isFinite)) {
      throw new TypeError('Finite yaw and pitch angles are required to calculate camera basis.');
    }
    const cosineYaw = Math.cos(yaw);
    const sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch);
    const sinePitch = Math.sin(pitch);
    return Object.freeze({
      offset: Object.freeze([
        cosinePitch * cosineYaw,
        cosinePitch * sineYaw,
        sinePitch
      ]),
      right: Object.freeze([-sineYaw, cosineYaw, 0]),
      up: Object.freeze([
        -sinePitch * cosineYaw,
        -sinePitch * sineYaw,
        cosinePitch
      ]),
      direction: Object.freeze([
        -cosinePitch * cosineYaw,
        -cosinePitch * sineYaw,
        -sinePitch
      ])
    });
  }

  function panOffset(deltaX, deltaY, distance, fovy, viewportHeight, yaw, pitch) {
    if (![deltaX, deltaY, distance, fovy, viewportHeight, yaw, pitch].every(Number.isFinite) ||
        distance <= 0 || fovy <= 0 || fovy >= Math.PI || viewportHeight <= 0) {
      throw new RangeError('Finite pointer movement and valid camera dimensions are required for panning.');
    }
    const basis = getScreenBasis(yaw, pitch);
    const metersPerPixel = 2 * distance * Math.tan(fovy / 2) / viewportHeight;
    return Object.freeze([
      (-basis.right[0] * deltaX + basis.up[0] * deltaY) * metersPerPixel,
      (-basis.right[1] * deltaX + basis.up[1] * deltaY) * metersPerPixel
    ]);
  }

  function classifyWheel(event, viewportHeight = 800) {
    const deltaX = normalizeWheelDelta({
      deltaY: Number.isFinite(event?.deltaX) ? event.deltaX : 0,
      deltaMode: event?.deltaMode
    }, viewportHeight);
    const deltaY = normalizeWheelDelta(event, viewportHeight);
    if (event.ctrlKey || event.metaKey) {
      return Object.freeze({ type: 'zoom', delta: deltaY });
    }
    if (event.shiftKey) {
      return Object.freeze({ type: 'pan', deltaX: deltaY, deltaY: 0 });
    }
    if (deltaX !== 0 || (event.deltaMode === 0 && Math.abs(deltaY) < 80)) {
      return Object.freeze({ type: 'pan', deltaX, deltaY });
    }
    return Object.freeze({ type: 'zoom', delta: deltaY });
  }

  function advanceProgress(progress, elapsedSeconds, speed, durationSeconds) {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1 ||
        !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 ||
        !SPEED_OPTIONS.includes(speed) ||
        !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError('Flight progress requires a normalized position, elapsed time, supported speed, and positive duration.');
    }
    return Math.min(1, progress + elapsedSeconds * speed / durationSeconds);
  }

  const api = Object.freeze({
    SPEED_OPTIONS, getZoomLimits, normalizeWheelDelta, zoomDistance,
    getOrbitAngles, orbitAngles, getScreenBasis, panOffset, classifyWheel, advanceProgress
  });
  root.MarsWalkNavigation = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
