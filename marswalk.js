(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const globe = window.MarsGlobe;
  const planner = window.MarsWalkPlanner;
  const navigation = window.MarsWalkNavigation;
  const science = window.MarsScienceData;
  const terrainApi = window.MarsWalkTerrain;
  const terrainModel = window.MarsTerrainModel;
  if (!globe || !planner || !navigation || !science || !terrainApi || !terrainModel || !window.Cesium) return;

  window.MarsWalkScene = class MarsWalkScene {
    constructor({ viewer, ellipsoid, Cesium, interactive = false }) {
      this.C = Cesium;
      this.viewer = viewer;
      this.interactive = interactive;
      this.ellipsoid = ellipsoid || viewer.scene.globe.ellipsoid;
      this.entities = [];
      this.endpointMarkers = new Map();
      this.primitives = [];
      this.terrain = null;
      this.terrainMesh = null;
      this.terrainPrimitive = null;
      this.wireframePrimitive = null;
      this.route = null;
      this.cameraSnapshot = null;
      this.localSceneActive = false;
      this.previousGlobeVisibility = true;
      this.previousSkyboxVisibility = true;
      this.drone = null;
      this.lastProgress = 0;
      this.cameraMotion = { position: null, direction: null, velocity: null, lateral: null };
      this.navigation = null;
      this.navigationCleanup = [];
      this.navigationFrame = null;
    }

    clear() {
      this.disableNavigation();
      this.clearRoute();
      for (const primitive of this.primitives.splice(0)) {
        this.viewer.scene.primitives.remove(primitive);
      }
      this.terrain = null;
      this.terrainMesh = null;
      this.terrainPrimitive = null;
      this.wireframePrimitive = null;
    }

    clearRoute() {
      for (const entity of this.entities.splice(0)) {
        this.viewer.entities.remove(entity);
      }
      this.clearEndpointMarkers();
      this.route = null;
      this.drone = null;
      this.completedRoute = null;
    }

    destroy() {
      this.clear();
      this.endLocalTerrain();
    }

    beginLocalTerrain() {
      if (!this.localSceneActive) {
        this.previousGlobeVisibility = this.viewer.scene.globe.show;
        this.previousSkyboxVisibility = !!(this.viewer.scene.skyBox && this.viewer.scene.skyBox.show !== undefined ? this.viewer.scene.skyBox.show : true);
      }
      this.viewer.scene.globe.show = false;
      if (this.viewer.scene.skyBox) this.viewer.scene.skyBox.show = false;
      this.localSceneActive = true;
    }

    endLocalTerrain() {
      if (!this.localSceneActive) return;
      this.disableNavigation();
      this.viewer.scene.globe.show = this.previousGlobeVisibility;
      if (this.viewer.scene.skyBox) this.viewer.scene.skyBox.show = this.previousSkyboxVisibility;
      this.localSceneActive = false;
      if (this.cameraSnapshot) {
        this.viewer.camera.setView({
          destination: this.cameraSnapshot.position,
          orientation: { direction: this.cameraSnapshot.direction, up: this.cameraSnapshot.up }
        });
      }
    }

    captureCamera() {
      this.cameraSnapshot = {
        position: this.C.Cartesian3.clone(this.viewer.camera.positionWC),
        direction: this.C.Cartesian3.clone(this.viewer.camera.directionWC),
        up: this.C.Cartesian3.clone(this.viewer.camera.upWC)
      };
    }

    localCartesian(point, clearanceM = 0) {
      if (!this.terrain || !point) return null;
      const position = this.terrain.localPosition(point, clearanceM);
      return new this.C.Cartesian3(position.x, position.y, position.z);
    }

    showTerrain(terrain, surfaceCanvas, wireframeEnabled = false, sharedMesh = null) {
      this.clear();
      this.terrain = terrain;
      this.beginLocalTerrain();
      const mesh = sharedMesh || terrain.buildMesh(false);
      this.terrainMesh = mesh;
      const geometry = new this.C.Geometry({
        attributes: {
          position: new this.C.GeometryAttribute({
            componentDatatype: this.C.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: mesh.positions
          }),
          normal: new this.C.GeometryAttribute({
            componentDatatype: this.C.ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            values: mesh.normals
          }),
          st: new this.C.GeometryAttribute({
            componentDatatype: this.C.ComponentDatatype.FLOAT,
            componentsPerAttribute: 2,
            values: mesh.textureCoordinates
          })
        },
        indices: mesh.indices,
        primitiveType: this.C.PrimitiveType.TRIANGLES,
        boundingSphere: this.C.BoundingSphere.fromVertices(mesh.positions)
      });
      this.terrainPrimitive = new this.C.Primitive({
        geometryInstances: new this.C.GeometryInstance({ geometry }),
        appearance: new this.C.MaterialAppearance({
          material: new this.C.Material({ fabric: { type: 'Image', uniforms: { image: surfaceCanvas } } }),
          vertexFormat: this.C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          translucent: false,
          closed: false
        }),
        asynchronous: false
      });
      this.viewer.scene.primitives.add(this.terrainPrimitive);
      this.primitives.push(this.terrainPrimitive);
      this.wireframePrimitive = this.createWireframePrimitive(mesh);
      this.wireframePrimitive.show = wireframeEnabled;
      this.viewer.scene.primitives.add(this.wireframePrimitive);
      this.primitives.push(this.wireframePrimitive);
      this.viewer.scene.requestRender();
      if (this.interactive) this.enableNavigation();
    }

    enableNavigation() {
      if (!this.interactive || this.navigation || !this.terrainMesh) return;
      const controller = this.viewer.scene.screenSpaceCameraController;
      const canvas = this.viewer.scene.canvas;
      const focus = new this.C.Cartesian3(0, 0,
        (this.terrainMesh.minimumElevationM + this.terrainMesh.maximumElevationM) / 2);
      const relief = this.terrainMesh.maximumElevationM - this.terrainMesh.minimumElevationM;
      const limits = navigation.getZoomLimits(this.terrainMesh.widthMeters, relief);
      const initialOrbit = navigation.getOrbitAngles(
        focus,
        this.viewer.camera.positionWC
      );
      this.navigation = {
        enabled: true,
        focus,
        targetFocus: this.C.Cartesian3.clone(focus),
        distance: limits.initial,
        targetDistance: limits.initial,
        yaw: initialOrbit.yaw,
        targetYaw: initialOrbit.yaw,
        pitch: initialOrbit.pitch,
        targetPitch: initialOrbit.pitch,
        limits,
        pointers: new Map(),
        pinchDistance: 0,
        lastFrameTime: null,
        previousEnableInputs: controller.enableInputs,
        previousTouchAction: canvas.style.touchAction
      };
      controller.enableInputs = false;
      canvas.style.touchAction = 'none';

      const pointerDown = event => {
        if (!this.navigation?.enabled) return;
        const touch = event.pointerType === 'touch';
        if (!touch && ![0, 1, 2].includes(event.button)) return;
        if (event.cancelable) event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        this.navigation.pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          action: touch || (event.button === 0 && !event.shiftKey) ? 'orbit' : 'pan'
        });
        this.navigation.pinchDistance = this.navigation.pointers.size === 2
          ? this.pointerDistance() : 0;
      };
      const pointerMove = event => {
        if (!this.navigation?.enabled || !this.navigation.pointers.has(event.pointerId)) return;
        if (event.cancelable) event.preventDefault();
        const pointer = this.navigation.pointers.get(event.pointerId);
        const previousCenter = this.navigation.pointers.size > 1 ? this.pointerCenter() : null;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (this.navigation.pointers.size >= 2) {
          const nextCenter = this.pointerCenter();
          this.panNavigation(
            nextCenter.x - previousCenter.x,
            nextCenter.y - previousCenter.y,
            canvas.clientHeight
          );
          const nextDistance = this.pointerDistance();
          if (this.navigation.pinchDistance > 0 && nextDistance > 0) {
            this.scaleNavigationDistance(this.navigation.pinchDistance / nextDistance);
          }
          this.navigation.pinchDistance = nextDistance;
        } else if (pointer.action === 'orbit') {
          this.orbitNavigation(dx, dy);
        } else {
          this.panNavigation(dx, dy, canvas.clientHeight);
        }
      };
      const pointerUp = event => {
        this.navigation?.pointers.delete(event.pointerId);
        if (this.navigation) {
          this.navigation.pinchDistance = this.navigation.pointers.size === 2
            ? this.pointerDistance() : 0;
        }
      };
      const wheel = event => {
        if (!this.navigation?.enabled) return;
        if (event.cancelable) event.preventDefault();
        const gesture = navigation.classifyWheel(event, canvas.clientHeight);
        if (gesture.type === 'zoom') this.zoomNavigation(gesture.delta);
        else this.panNavigation(gesture.deltaX, gesture.deltaY, canvas.clientHeight);
      };
      let gestureScale = 1;
      const gestureStart = event => {
        if (!this.navigation?.enabled) return;
        if (event.cancelable) event.preventDefault();
        gestureScale = Number.isFinite(event.scale) ? event.scale : 1;
      };
      const gestureChange = event => {
        if (!this.navigation?.enabled || !Number.isFinite(event.scale) || event.scale <= 0) return;
        if (event.cancelable) event.preventDefault();
        this.scaleNavigationDistance(gestureScale / event.scale);
        gestureScale = event.scale;
      };
      const gestureEnd = () => { gestureScale = 1; };
      const contextMenu = event => {
        if (this.navigation?.enabled) event.preventDefault();
      };
      const listeners = [
        ['pointerdown', pointerDown, { passive: false }],
        ['pointermove', pointerMove, { passive: false }],
        ['pointerup', pointerUp],
        ['pointercancel', pointerUp],
        ['wheel', wheel, { passive: false }],
        ['gesturestart', gestureStart, { passive: false }],
        ['gesturechange', gestureChange, { passive: false }],
        ['gestureend', gestureEnd],
        ['contextmenu', contextMenu]
      ];
      for (const [type, callback, options] of listeners) {
        canvas.addEventListener(type, callback, options);
        this.navigationCleanup.push(() => canvas.removeEventListener(type, callback));
      }
    }

    disableNavigation() {
      if (!this.navigation) return;
      if (this.navigationFrame !== null) cancelAnimationFrame(this.navigationFrame);
      this.navigationFrame = null;
      this.navigationCleanup.splice(0).forEach(cleanup => cleanup());
      const controller = this.viewer.scene.screenSpaceCameraController;
      controller.enableInputs = this.navigation.previousEnableInputs;
      this.viewer.scene.canvas.style.touchAction = this.navigation.previousTouchAction;
      this.navigation = null;
    }

    setNavigationEnabled(enabled) {
      if (!this.navigation) return;
      this.navigation.enabled = Boolean(enabled);
      if (!this.navigation.enabled) {
        this.navigation.pointers.clear();
        this.navigation.pinchDistance = 0;
      }
    }

    pointerDistance() {
      const points = [...this.navigation.pointers.values()];
      return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    pointerCenter() {
      const points = [...this.navigation.pointers.values()];
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length
      };
    }

    clampFocus(x, y) {
      const halfExtent = this.terrain.region.halfExtentKm * 1000;
      const boundedX = Math.max(-halfExtent, Math.min(halfExtent, x));
      const boundedY = Math.max(-halfExtent, Math.min(halfExtent, y));
      const sample = this.terrain.inspectLocalPosition({ x: boundedX, y: boundedY });
      return new this.C.Cartesian3(boundedX, boundedY, sample.referenceElevationM + sample.localHeightM);
    }

    panNavigation(dx, dy, viewportHeight) {
      if (!this.navigation || !viewportHeight) return;
      const state = this.navigation;
      const fovy = this.viewer.camera.frustum.fovy || Math.PI / 3;
      const offset = navigation.panOffset(
        dx, dy, state.distance, fovy, viewportHeight, state.targetYaw, state.targetPitch
      );
      const next = this.clampFocus(
        state.targetFocus.x + offset[0],
        state.targetFocus.y + offset[1]
      );
      state.targetFocus = next;
      this.scheduleNavigationFrame();
    }

    orbitNavigation(dx, dy) {
      const state = this.navigation;
      if (!state) return;
      const angles = navigation.orbitAngles(
        state.targetYaw, state.targetPitch, dx, dy
      );
      state.targetYaw = angles.yaw;
      state.targetPitch = angles.pitch;
      this.scheduleNavigationFrame();
    }

    zoomNavigation(deltaPixels) {
      const state = this.navigation;
      if (!state) return;
      state.targetDistance = navigation.zoomDistance(
        state.targetDistance, deltaPixels, state.limits, 0.0025
      );
      this.scheduleNavigationFrame();
    }

    scaleNavigationDistance(factor) {
      const state = this.navigation;
      if (!state || !Number.isFinite(factor) || factor <= 0) return;
      state.targetDistance = Math.max(state.limits.minimum,
        Math.min(state.limits.maximum, state.targetDistance * factor));
      this.scheduleNavigationFrame();
    }

    scheduleNavigationFrame() {
      if (this.navigationFrame !== null) return;
      const update = now => {
        this.navigationFrame = null;
        const state = this.navigation;
        if (!state || !state.enabled) return;
        const elapsed = state.lastFrameTime === null ? 1 / 60 :
          Math.max(0, Math.min(0.1, (now - state.lastFrameTime) / 1000));
        state.lastFrameTime = now;
        const damping = 1 - Math.exp(-12 * elapsed);
        state.distance += (state.targetDistance - state.distance) * damping;
        this.C.Cartesian3.lerp(state.focus, state.targetFocus, damping, state.focus);
        state.yaw += (state.targetYaw - state.yaw) * damping;
        state.pitch += (state.targetPitch - state.pitch) * damping;
        if (Math.abs(state.distance - state.targetDistance) < 0.1) state.distance = state.targetDistance;
        if (Math.abs(state.yaw - state.targetYaw) < 1e-5) state.yaw = state.targetYaw;
        if (Math.abs(state.pitch - state.targetPitch) < 1e-5) state.pitch = state.targetPitch;
        if (this.C.Cartesian3.distance(state.focus, state.targetFocus) < 0.1) {
          this.C.Cartesian3.clone(state.targetFocus, state.focus);
        }
        this.applyNavigationPose();
        if (state.distance !== state.targetDistance ||
            state.yaw !== state.targetYaw || state.pitch !== state.targetPitch ||
            this.C.Cartesian3.distance(state.focus, state.targetFocus) >= 0.1) {
          this.navigationFrame = requestAnimationFrame(update);
        } else state.lastFrameTime = null;
      };
      this.navigationFrame = requestAnimationFrame(update);
    }

    applyNavigationPose() {
      const state = this.navigation;
      if (!state) return;
      const basis = navigation.getScreenBasis(state.yaw, state.pitch);
      let distance = state.distance;
      let safePosition = new this.C.Cartesian3(
        state.focus.x + basis.offset[0] * distance,
        state.focus.y + basis.offset[1] * distance,
        state.focus.z + basis.offset[2] * distance
      );
      const halfExtent = this.terrain.region.halfExtentKm * 1000;
      if (Math.abs(safePosition.x) <= halfExtent && Math.abs(safePosition.y) <= halfExtent) {
        const ground = this.terrain.inspectLocalPosition(safePosition);
        if (ground && safePosition.z < ground.meshLocalHeightM + 50) {
          const requiredDistance = (ground.meshLocalHeightM + 50 - state.focus.z) /
            Math.max(0.01, basis.offset[2]);
          distance = Math.min(state.limits.maximum, Math.max(distance, requiredDistance));
          state.distance = distance;
          state.targetDistance = Math.max(state.targetDistance, distance);
          safePosition = new this.C.Cartesian3(
            state.focus.x + basis.offset[0] * distance,
            state.focus.y + basis.offset[1] * distance,
            Math.max(state.focus.z + basis.offset[2] * distance, ground.meshLocalHeightM + 50)
          );
        }
      }
      const direction = this.C.Cartesian3.normalize(
        this.C.Cartesian3.subtract(state.focus, safePosition, new this.C.Cartesian3()),
        new this.C.Cartesian3()
      );
      const right = new this.C.Cartesian3(-Math.sin(state.yaw), Math.cos(state.yaw), 0);
      const up = this.C.Cartesian3.normalize(
        this.C.Cartesian3.cross(right, direction, new this.C.Cartesian3()),
        new this.C.Cartesian3()
      );
      this.viewer.camera.setView({
        destination: safePosition,
        orientation: { direction, up }
      });
      this.cameraMotion.position = this.C.Cartesian3.clone(safePosition);
      this.cameraMotion.direction = this.C.Cartesian3.clone(direction);
      this.cameraMotion.velocity = new this.C.Cartesian3();
      this.viewer.scene.requestRender();
    }

    syncNavigationFromCamera() {
      const state = this.navigation;
      if (!state) return;
      const canvas = this.viewer.scene.canvas;
      const center = this.pickTerrainPosition(new this.C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      if (center) state.focus = this.clampFocus(center.x, center.y);
      else {
        state.focus = new this.C.Cartesian3(0, 0,
          (this.terrainMesh.minimumElevationM + this.terrainMesh.maximumElevationM) / 2);
      }
      state.targetFocus = this.C.Cartesian3.clone(state.focus);
      const orbit = navigation.getOrbitAngles(state.focus, this.viewer.camera.positionWC);
      state.yaw = state.targetYaw = orbit.yaw;
      state.pitch = state.targetPitch = orbit.pitch;
      state.distance = state.targetDistance = Math.max(
        state.limits.minimum, Math.min(state.limits.maximum, orbit.distance)
      );
      state.lastFrameTime = null;
    }

    resetNavigationView(target, destination) {
      if (!this.navigation) return false;
      const state = this.navigation;
      state.focus = this.C.Cartesian3.clone(target);
      state.targetFocus = this.C.Cartesian3.clone(target);
      const orbit = navigation.getOrbitAngles(target, destination);
      state.distance = state.targetDistance = Math.max(
        state.limits.minimum, Math.min(state.limits.maximum, orbit.distance)
      );
      state.yaw = state.targetYaw = orbit.yaw;
      state.pitch = state.targetPitch = orbit.pitch;
      state.lastFrameTime = null;
      this.applyNavigationPose();
      return true;
    }

    createWireframePrimitive(mesh) {
      const size = mesh.size;
      const edgeCount = 2 * size * (size - 1) + (size - 1) ** 2;
      const indices = new Uint32Array(edgeCount * 2);
      let offset = 0;
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const index = row * size + column;
          if (column < size - 1) {
            indices[offset++] = index;
            indices[offset++] = index + 1;
          }
          if (row < size - 1) {
            indices[offset++] = index;
            indices[offset++] = index + size;
          }
          if (row < size - 1 && column < size - 1) {
            indices[offset++] = index + 1;
            indices[offset++] = index + size;
          }
        }
      }
      return new this.C.Primitive({
        geometryInstances: new this.C.GeometryInstance({
          geometry: new this.C.Geometry({
            attributes: {
              position: new this.C.GeometryAttribute({
                componentDatatype: this.C.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: mesh.positions
              })
            },
            indices,
            primitiveType: this.C.PrimitiveType.LINES,
            boundingSphere: this.C.BoundingSphere.fromVertices(mesh.positions)
          }),
          attributes: {
            color: this.C.ColorGeometryInstanceAttribute.fromColor(this.C.Color.fromCssColorString('#fff0d6'))
          }
        }),
        appearance: new this.C.PerInstanceColorAppearance({
          flat: true, translucent: false, closed: false
        }),
        asynchronous: false
      });
    }

    setSurfaceTexture(surfaceCanvas) {
      if (!this.terrainPrimitive) throw new Error('MarsWalk terrain must be rendered before changing its surface texture.');
      this.terrainPrimitive.appearance.material = new this.C.Material({
        fabric: { type: 'Image', uniforms: { image: surfaceCanvas } }
      });
      this.viewer.scene.requestRender();
    }

    setWireframe(enabled) {
      if (this.wireframePrimitive) this.wireframePrimitive.show = Boolean(enabled);
      this.viewer.scene.requestRender();
    }

    pickTerrainPosition(screenPosition) {
      if (!this.terrainPrimitive) return null;
      const picked = this.viewer.scene.pick(screenPosition);
      if (!picked || ![this.terrainPrimitive, this.wireframePrimitive].includes(picked.primitive)) return null;
      const ray = this.viewer.camera.getPickRay(screenPosition);
      if (!ray) return null;
      const positions = this.terrainMesh.positions;
      const indices = this.terrainMesh.indices;
      const origin = ray.origin, direction = ray.direction;
      let nearest = Infinity;
      for (let offset = 0; offset < indices.length; offset += 3) {
        const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3;
        const edge1X = positions[b] - positions[a];
        const edge1Y = positions[b + 1] - positions[a + 1];
        const edge1Z = positions[b + 2] - positions[a + 2];
        const edge2X = positions[c] - positions[a];
        const edge2Y = positions[c + 1] - positions[a + 1];
        const edge2Z = positions[c + 2] - positions[a + 2];
        const crossX = direction.y * edge2Z - direction.z * edge2Y;
        const crossY = direction.z * edge2X - direction.x * edge2Z;
        const crossZ = direction.x * edge2Y - direction.y * edge2X;
        const determinant = edge1X * crossX + edge1Y * crossY + edge1Z * crossZ;
        if (Math.abs(determinant) < 1e-12) continue;
        const inverseDeterminant = 1 / determinant;
        const fromAX = origin.x - positions[a];
        const fromAY = origin.y - positions[a + 1];
        const fromAZ = origin.z - positions[a + 2];
        const u = (fromAX * crossX + fromAY * crossY + fromAZ * crossZ) * inverseDeterminant;
        if (u < 0 || u > 1) continue;
        const qX = fromAY * edge1Z - fromAZ * edge1Y;
        const qY = fromAZ * edge1X - fromAX * edge1Z;
        const qZ = fromAX * edge1Y - fromAY * edge1X;
        const v = (direction.x * qX + direction.y * qY + direction.z * qZ) * inverseDeterminant;
        if (v < 0 || u + v > 1) continue;
        const distance = (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverseDeterminant;
        if (distance >= 0 && distance < nearest) nearest = distance;
      }
      if (!Number.isFinite(nearest)) return null;
      return {
        x: origin.x + direction.x * nearest,
        y: origin.y + direction.y * nearest,
        z: origin.z + direction.z * nearest
      };
    }

    resetView() {
      if (!this.terrainMesh) return;
      const target = new this.C.Cartesian3(0, 0,
        (this.terrainMesh.minimumElevationM + this.terrainMesh.maximumElevationM) / 2);
      const distance = this.terrainMesh.widthMeters * 1.4;
      const destination = new this.C.Cartesian3(
        0, -distance, this.terrainMesh.maximumElevationM + distance * 0.8
      );
      if (this.resetNavigationView(target, destination)) return;
      const direction = this.C.Cartesian3.normalize(
        this.C.Cartesian3.subtract(target, destination, new this.C.Cartesian3()),
        new this.C.Cartesian3()
      );
      this.setCameraPose(destination, direction, 0, true);
      this.viewer.scene.requestRender();
    }

    setRoute(route, terrain, showDrone = true) {
      if (!route || !terrain) return;
      this.clearRoute();
      this.terrain = terrain;
      this.route = route;
      const positions = route.map(point => this.localCartesian(point, point.clearanceM));
      const planned = this.viewer.entities.add({
        name: 'MarsWalk planned flight path',
        polyline: {
          positions,
          width: 5,
          arcType: this.C.ArcType.NONE,
          clampToGround: false,
          material: new this.C.PolylineGlowMaterialProperty({
            glowPower: 0.1, color: this.C.Color.fromCssColorString('#ffc278')
          })
        }
      });
      const completed = this.viewer.entities.add({
        name: 'MarsWalk completed flight path',
        polyline: {
          positions: positions.slice(0, 1),
          width: 7,
          arcType: this.C.ArcType.NONE,
          clampToGround: false,
          material: new this.C.PolylineGlowMaterialProperty({
            glowPower: 0.12, color: this.C.Color.fromCssColorString('#5fe3dc')
          })
        }
      });
      this.entities.push(planned, completed);
      this.setEndpointMarkers(route[0], route.at(-1));
      this.drone = showDrone ? this.viewer.entities.add({
        name: 'MarsWalk drone',
        position: this.localCartesian(route[0], route[0].clearanceM),
        point: {
          pixelSize: 14,
          color: this.C.Color.fromCssColorString('#5fe3dc'),
          outlineColor: this.C.Color.WHITE,
          outlineWidth: 2
        }
      }) : null;
      if (this.drone) this.entities.push(this.drone);
      this.completedRoute = completed;
      this.viewer.scene.requestRender();
    }

    clearEndpointMarkers() {
      for (const entity of this.endpointMarkers.values()) this.viewer.entities.remove(entity);
      this.endpointMarkers.clear();
    }

    setEndpointMarker(which, point) {
      const existing = this.endpointMarkers.get(which);
      if (existing) {
        this.viewer.entities.remove(existing);
        this.endpointMarkers.delete(which);
      }
      if (!point || !this.terrain) return;
      const color = which === 'start' ? '#5fe3dc' : '#f06d5e';
      const label = which === 'start' ? 'START' : 'DESTINATION';
      const entity = this.viewer.entities.add({
        name: `MarsWalk ${label.toLowerCase()} endpoint`,
        position: this.localCartesian(point, 3),
        point: {
          pixelSize: 12,
          color: this.C.Color.fromCssColorString(color),
          outlineColor: this.C.Color.BLACK,
          outlineWidth: 2
        },
        label: {
          text: label,
          font: 'bold 10px sans-serif',
          fillColor: this.C.Color.WHITE,
          outlineColor: this.C.Color.BLACK,
          outlineWidth: 3,
          style: this.C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new this.C.Cartesian2(0, -18),
          disableDepthTestDistance: 1e7
        }
      });
      this.endpointMarkers.set(which, entity);
    }

    setEndpointMarkers(start, destination) {
      this.clearEndpointMarkers();
      this.setEndpointMarker('start', start);
      this.setEndpointMarker('destination', destination);
      this.viewer.scene.requestRender();
    }

    setCameraPose(destination, direction, deltaSeconds = 0, snap = false, upHint = null) {
      const C = this.C;
      if (!this.cameraMotion.position) {
        this.cameraMotion.position = C.Cartesian3.clone(this.viewer.camera.positionWC);
        this.cameraMotion.direction = C.Cartesian3.clone(this.viewer.camera.directionWC);
        this.cameraMotion.velocity = new C.Cartesian3();
      }
      if (snap || !(deltaSeconds > 0)) {
        C.Cartesian3.clone(destination, this.cameraMotion.position);
        C.Cartesian3.clone(direction, this.cameraMotion.direction);
        C.Cartesian3.clone(C.Cartesian3.ZERO, this.cameraMotion.velocity);
      } else {
        const error = C.Cartesian3.subtract(destination, this.cameraMotion.position, new C.Cartesian3());
        const acceleration = C.Cartesian3.subtract(
          C.Cartesian3.multiplyByScalar(error, 7, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(this.cameraMotion.velocity, 5, new C.Cartesian3()),
          new C.Cartesian3()
        );
        const accelerationMagnitude = C.Cartesian3.magnitude(acceleration);
        if (accelerationMagnitude > 60000) {
          C.Cartesian3.multiplyByScalar(acceleration, 60000 / accelerationMagnitude, acceleration);
        }
        C.Cartesian3.add(this.cameraMotion.velocity,
          C.Cartesian3.multiplyByScalar(acceleration, deltaSeconds, new C.Cartesian3()),
          this.cameraMotion.velocity);
        const speed = C.Cartesian3.magnitude(this.cameraMotion.velocity);
        if (speed > 24000) C.Cartesian3.multiplyByScalar(this.cameraMotion.velocity, 24000 / speed, this.cameraMotion.velocity);
        C.Cartesian3.add(this.cameraMotion.position,
          C.Cartesian3.multiplyByScalar(this.cameraMotion.velocity, deltaSeconds, new C.Cartesian3()),
          this.cameraMotion.position);

        const dot = Math.max(-1, Math.min(1, C.Cartesian3.dot(this.cameraMotion.direction, direction)));
        const angle = Math.acos(dot);
        const maxAngle = Math.min(angle, 0.8 * deltaSeconds);
        const blend = angle > 1e-8 ? maxAngle / angle : 1;
        C.Cartesian3.lerp(this.cameraMotion.direction, direction, blend, this.cameraMotion.direction);
        C.Cartesian3.normalize(this.cameraMotion.direction, this.cameraMotion.direction);
      }
      let basis;
      if (upHint) {
        const preferredUp = C.Cartesian3.normalize(C.Cartesian3.clone(upHint), new C.Cartesian3());
        const right = C.Cartesian3.cross(this.cameraMotion.direction, preferredUp, new C.Cartesian3());
        if (C.Cartesian3.magnitudeSquared(right) > 1e-8) {
          C.Cartesian3.normalize(right, right);
          basis = {
            direction: C.Cartesian3.clone(this.cameraMotion.direction),
            up: C.Cartesian3.normalize(C.Cartesian3.cross(right, this.cameraMotion.direction, new C.Cartesian3()), new C.Cartesian3())
          };
        }
      }
      basis ||= stableCameraBasis(this.cameraMotion.direction);
      this.viewer.camera.setView({
        destination: C.Cartesian3.clone(this.cameraMotion.position),
        orientation: { direction: basis.direction, up: basis.up }
      });
      this.viewer.scene.requestRender();
      if (snap) this.syncNavigationFromCamera();
    }

    updateProgress(progress, route, deltaSeconds = 0, snap = false, cameraMode = 'pilot') {
      if (!this.terrain || !route || !route.length) return;
      const sample = planner.sampleTrajectory(route, progress);
      const position = this.localCartesian(sample, sample.clearanceM);
      if (this.drone) this.drone.position = position;
      if (this.completedRoute) {
        const completedPositions = route.slice(0, sample.index + 1)
          .map(point => this.localCartesian(point, point.clearanceM));
        if (progress > 0 && sample.index < route.length - 1) completedPositions.push(position);
        this.completedRoute.polyline.positions = completedPositions;
      }
      if (cameraMode === 'pilot') {
        const before = this.localCartesian(route[Math.max(0, sample.index - 1)], route[Math.max(0, sample.index - 1)].clearanceM);
        const after = this.localCartesian(route[Math.min(route.length - 1, sample.index + 1)], route[Math.min(route.length - 1, sample.index + 1)].clearanceM);
        const direction = this.C.Cartesian3.subtract(after, before, new this.C.Cartesian3());
        if (this.C.Cartesian3.magnitudeSquared(direction) < 1e-8) direction.x = 1;
        this.C.Cartesian3.normalize(direction, direction);
        const cameraPosition = this.C.Cartesian3.clone(position);
        cameraPosition.x += direction.x * 5;
        cameraPosition.y += direction.y * 5;
        cameraPosition.z += direction.z * 5 + 6;
        this.setCameraPose(cameraPosition, direction, deltaSeconds, snap);
      } else {
        this.updateAuxiliaryCamera(cameraMode, progress, route, sample, deltaSeconds, snap);
      }
      this.viewer.scene.requestRender();
    }

    updateAuxiliaryCamera(mode, progress, route, sample, deltaSeconds, snap) {
      const C = this.C;
      const current = this.localCartesian(sample, sample.clearanceM);
      const previousSample = planner.sampleTrajectory(route, Math.max(0, progress - 0.045));
      const futureSample = planner.sampleTrajectory(route, Math.min(1, progress + 0.045));
      const previous = this.localCartesian(previousSample, previousSample.clearanceM);
      const future = this.localCartesian(futureSample, futureSample.clearanceM);
      const forward = C.Cartesian3.subtract(future, previous, new C.Cartesian3());
      forward.z = 0;
      if (C.Cartesian3.magnitudeSquared(forward) < 1e-8) forward.x = 1;
      C.Cartesian3.normalize(forward, forward);
      const routeSpanM = Math.max(0, futureSample.distanceKm - previousSample.distanceKm) * 1000;
      const startIndex = Math.max(0, previousSample.index);
      const endIndex = Math.min(route.length - 1, futureSample.index);
      let routeMinimumZ = Infinity, routeMaximumZ = -Infinity, terrainMaximumZ = -Infinity;
      for (let index = startIndex; index <= endIndex; index++) {
        const flightPosition = this.localCartesian(route[index], route[index].clearanceM);
        const groundPosition = this.localCartesian(route[index], 0);
        routeMinimumZ = Math.min(routeMinimumZ, groundPosition.z, flightPosition.z);
        routeMaximumZ = Math.max(routeMaximumZ, groundPosition.z, flightPosition.z);
        terrainMaximumZ = Math.max(terrainMaximumZ, groundPosition.z);
      }
      if (!Number.isFinite(terrainMaximumZ)) terrainMaximumZ = this.terrainMesh.maximumElevationM;

      if (mode === 'top') {
        const height = Math.max(9000, Math.min(32000, routeSpanM * 0.72));
        const position = new C.Cartesian3(
          current.x, current.y,
          Math.max(current.z + height, terrainMaximumZ + Math.max(6000, height * 0.55))
        );
        this.setCameraPose(position, new C.Cartesian3(0, 0, -1), deltaSeconds, snap,
          new C.Cartesian3(0, 1, 0));
        return;
      }

      let lateral = new C.Cartesian3(-forward.y, forward.x, 0);
      if (this.cameraMotion.lateral && C.Cartesian3.dot(lateral, this.cameraMotion.lateral) < 0) {
        C.Cartesian3.negate(lateral, lateral);
      }
      if (snap || !this.cameraMotion.lateral || !(deltaSeconds > 0)) {
        this.cameraMotion.lateral = C.Cartesian3.clone(lateral);
      } else {
        const blend = 1 - Math.exp(-deltaSeconds / 0.65);
        C.Cartesian3.lerp(this.cameraMotion.lateral, lateral, blend, this.cameraMotion.lateral);
        C.Cartesian3.normalize(this.cameraMotion.lateral, this.cameraMotion.lateral);
      }

      const verticalRange = Math.max(0, routeMaximumZ - routeMinimumZ);
      const sideDistance = Math.max(9000, Math.min(22000, routeSpanM * 0.68));
      const position = new C.Cartesian3(
        current.x + this.cameraMotion.lateral.x * sideDistance,
        current.y + this.cameraMotion.lateral.y * sideDistance,
        Math.max(current.z + Math.max(3500, verticalRange * 0.72), terrainMaximumZ + 2200,
          this.terrainMesh.maximumElevationM + 1500)
      );
      const direction = C.Cartesian3.normalize(
        C.Cartesian3.subtract(current, position, new C.Cartesian3()),
        new C.Cartesian3()
      );
      this.setCameraPose(position, direction, deltaSeconds, snap, new C.Cartesian3(0, 0, 1));
    }
  };

  const C = globe.getCesium();
  const viewer = globe.getViewer();
  const ellipsoid = globe.getEllipsoid();
  const requests = window.MarsData.createRequests();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanups = [];
  const entities = [];
  const formatNumber = value => Math.round(value).toLocaleString();
  const modeDefaults = planner.MODES;
  let grid = null;
  let gridPromise = null;
  let plan = null;
  let state = 'closed';
  let selectionPoint = 0;
  let removeSelectionHandler = null;
  let selectionName = null;
  let requestId = 0;
  let animationFrame = null;
  let lastFrameTime = null;
  let progress = 0;
  let playbackSpeed = 1;
  let cameraSnapshot = null;
  let previousEnableInputs = null;
  let planStale = false;
  let baselineEntity = null;
  let plannedEntity = null;
  let completedEntity = null;
  let currentEntity = null;
  let regionalTerrain = null;
  let currentSurfaceCanvas = null;
  let localTerrainPrimitive = null;
  let localSceneActive = false;
  let displayMode = 'terrain-explorer';
  let wireframeEnabled = false;
  let displayRequestId = 0;
  let coverageRequestId = 0;
  let priorGlobeVisibility = true;
  let priorSkyboxVisibility = true;
  let imageryWarning = '';
  const routeScene = new window.MarsWalkScene({ viewer, ellipsoid, Cesium: C, interactive: true });
  let pilotViewer = null;
  let pilotScene = null;
  let pilotRenderErrorReported = false;
  let pilotViewError = '';
  let lastPilotRenderTime = 0;
  const auxiliaryViews = new Map();
  let flightLayoutTimer = null;
  const patchCache = new Map();

  function listen(element, type, callback) {
    element.addEventListener(type, callback);
    cleanups.push(() => element.removeEventListener(type, callback));
  }

  function setStatus(message, warning = false) {
    $('marswalk-status').textContent = message;
    $('marswalk-status').classList.toggle('warning', warning);
  }

  function setSelectionStatus(message, warning = false) {
    $('marswalk-selection-help').textContent = message;
    $('marswalk-selection-help').classList.toggle('warning', warning);
  }

  function createSecondaryViewer(container) {
    const secondary = new C.Viewer($(container), {
      globe: new C.Globe(ellipsoid),
      mapProjection: new C.GeographicProjection(ellipsoid),
      terrainProvider: new C.EllipsoidTerrainProvider({ ellipsoid }),
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
      vrButton: false, animation: false, timeline: false, selectionIndicator: false,
      infoBox: false, sceneMode: C.SceneMode.SCENE3D, scene3DOnly: true,
      skyAtmosphere: false, shouldAnimate: false, targetFrameRate: 30
    });
    secondary.useBrowserRecommendedResolution = false;
    secondary.useDefaultRenderLoop = false;
    secondary.resolutionScale = Math.min(1, 1.5 / (window.devicePixelRatio || 1));
    secondary.scene.globe.show = false;
    secondary.scene.globe.enableLighting = false;
    secondary.scene.backgroundColor = C.Color.fromCssColorString('#080d13');
    if (secondary.scene.skyBox) secondary.scene.skyBox.show = false;
    if (secondary.scene.sun) secondary.scene.sun.show = false;
    if (secondary.scene.moon) secondary.scene.moon.show = false;
    secondary.scene.screenSpaceCameraController.enableInputs = false;
    return secondary;
  }

  function setFlightInterface(active, hidePilot = false) {
    if (flightLayoutTimer !== null) {
      clearTimeout(flightLayoutTimer);
      flightLayoutTimer = null;
    }
    if (active) {
      $('marswalk-auxiliary-views').hidden = false;
      $('marswalk-flight-controls').hidden = false;
      if (pilotViewer) $('marswalk-pilot-frame').hidden = false;
      requestAnimationFrame(() => {
        if (state === 'playing') document.body.classList.add('marswalk-flight-active');
      });
      return;
    }
    document.body.classList.remove('marswalk-flight-active');
    $('marswalk-flight-controls').hidden = true;
    if (hidePilot) $('marswalk-pilot-frame').hidden = true;
    flightLayoutTimer = setTimeout(() => {
      flightLayoutTimer = null;
      $('marswalk-auxiliary-views').hidden = true;
      destroyAuxiliaryViews();
    }, 300);
  }

  function ensurePilotView() {
    if (pilotRenderErrorReported) return false;
    if (pilotViewer && !pilotViewer.isDestroyed()) return true;
    try {
      pilotViewer = createSecondaryViewer('marswalk-pilot-canvas');
      pilotScene = new window.MarsWalkScene({ viewer: pilotViewer, ellipsoid, Cesium: C });
      if (regionalTerrain && currentSurfaceCanvas) {
        pilotScene.showTerrain(regionalTerrain, currentSurfaceCanvas, wireframeEnabled, routeScene.terrainMesh);
        if (plan) {
          pilotScene.setRoute(plan.trajectory, regionalTerrain, false);
          pilotScene.updateProgress(progress, plan.trajectory, 0, true);
        }
      }
      $('marswalk-pilot-frame').hidden = false;
      if (!renderPilotView(true)) return false;
      pilotViewError = '';
      return true;
    } catch (error) {
      pilotScene?.destroy();
      if (pilotViewer && !pilotViewer.isDestroyed()) pilotViewer.destroy();
      pilotViewer = null;
      pilotScene = null;
      $('marswalk-pilot-frame').hidden = true;
      pilotViewError = `The pilot view could not initialize: ${error.message}.`;
      setStatus(`${pilotViewError} The primary MarsWalk view remains available.`, true);
      return false;
    }
  }

  function renderPilotView(force = false) {
    if (!pilotViewer || pilotViewer.isDestroyed() || $('marswalk-pilot-frame').hidden) return false;
    const now = performance.now();
    if (!force && now - lastPilotRenderTime < 1000 / 30) return true;
    try {
      pilotViewer.resize();
      pilotViewer.render();
      lastPilotRenderTime = now;
      return true;
    } catch (error) {
      $('marswalk-pilot-frame').hidden = true;
      if (!pilotRenderErrorReported) {
        pilotRenderErrorReported = true;
        pilotViewError = `The pilot view stopped rendering: ${error.message}.`;
        setStatus(`${pilotViewError} The primary view and flight remain active.`, true);
      }
      return false;
    }
  }

  function ensureAuxiliaryView(mode) {
    if (auxiliaryViews.has(mode)) return true;
    const container = mode === 'top' ? 'marswalk-top-canvas' : 'marswalk-side-canvas';
    const frame = $(container).closest('.marswalk-auxiliary-view');
    let viewer = null, scene = null;
    frame.hidden = false;
    try {
      viewer = createSecondaryViewer(container);
      scene = new window.MarsWalkScene({ viewer, ellipsoid, Cesium: C });
      scene.showTerrain(regionalTerrain, currentSurfaceCanvas, wireframeEnabled, routeScene.terrainMesh);
      scene.setRoute(plan.trajectory, regionalTerrain);
      scene.updateProgress(progress, plan.trajectory, 0, true, mode);
      const view = { viewer, scene, mode, lastRenderTime: 0 };
      auxiliaryViews.set(mode, view);
      if (!renderAuxiliaryView(view, true)) throw new Error('The camera scene could not render.');
      return true;
    } catch (error) {
      auxiliaryViews.delete(mode);
      scene?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      frame.hidden = true;
      setStatus(`The ${mode} camera could not initialize: ${error.message}. Other MarsWalk views remain available.`, true);
      return false;
    }
  }

  function renderAuxiliaryView(view, force = false) {
    if (!view || view.renderFailed || view.viewer.isDestroyed()) return false;
    const now = performance.now();
    if (!force && now - view.lastRenderTime < 1000 / 30) return true;
    try {
      view.viewer.resize();
      view.viewer.render();
      view.lastRenderTime = now;
      return true;
    } catch (error) {
      view.renderFailed = true;
      setStatus(`The ${view.mode} camera stopped rendering: ${error.message}. Other MarsWalk views remain active.`, true);
      return false;
    }
  }

  function destroyAuxiliaryView(view) {
    if (!view) return;
    auxiliaryViews.delete(view.mode);
    view.scene.destroy();
    if (!view.viewer.isDestroyed()) view.viewer.destroy();
    const container = view.mode === 'top' ? 'marswalk-top-canvas' : 'marswalk-side-canvas';
    $(container).closest('.marswalk-auxiliary-view').hidden = true;
  }

  function destroyAuxiliaryViews() {
    for (const view of auxiliaryViews.values()) destroyAuxiliaryView(view);
  }

  function destroyPilotView() {
    pilotScene?.destroy();
    pilotScene = null;
    if (pilotViewer && !pilotViewer.isDestroyed()) pilotViewer.destroy();
    pilotViewer = null;
    pilotRenderErrorReported = false;
    pilotViewError = '';
    lastPilotRenderTime = 0;
    $('marswalk-pilot-frame').hidden = true;
  }

  function normalizedLongitude(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function formatInspectionLongitude(value, fractionDigits = 5) {
    const longitude = normalizedLongitude(value);
    return `${Math.abs(longitude).toFixed(fractionDigits)}°${longitude < 0 ? 'W' : 'E'}`;
  }

  function coordinateFields() {
    const values = {
      start: {
        latitude: $('marswalk-start-lat').valueAsNumber,
        longitude: $('marswalk-start-lon').valueAsNumber
      },
      destination: {
        latitude: $('marswalk-dest-lat').valueAsNumber,
        longitude: $('marswalk-dest-lon').valueAsNumber
      }
    };
    values.start = planner.validatePoint(values.start, 'Start point');
    values.destination = planner.validatePoint(values.destination, 'Destination');
    return values;
  }

  function writeCoordinate(which, point) {
    $(`marswalk-${which}-lat`).value = point.latitude.toFixed(5);
    $(`marswalk-${which}-lon`).value = normalizedLongitude(point.longitude).toFixed(5);
    updateEndpointSummary();
  }

  function updateEndpointSummary() {
    for (const [which, label] of [['start', 'marswalk-start-summary'], ['dest', 'marswalk-dest-summary']]) {
      const latitude = $(`marswalk-${which}-lat`).valueAsNumber;
      const longitude = $(`marswalk-${which}-lon`).valueAsNumber;
      $(label).textContent = Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `${latitude.toFixed(3)}°, ${formatInspectionLongitude(longitude, 3)}`
        : 'Not selected';
    }
    updateEndpointMarkers();
    updateJourneyControls();
  }

  function updateEndpointMarkers() {
    const points = { start: null, destination: null };
    const warnings = [];
    if (localSceneActive && regionalTerrain && selectedRegion()?.id === regionalTerrain.region.id) {
      for (const [which, label, prefix] of [
        ['start', 'Start', 'marswalk-start'],
        ['dest', 'Destination', 'marswalk-dest']
      ]) {
        const latitudeInput = $(`${prefix}-lat`);
        const longitudeInput = $(`${prefix}-lon`);
        if (!latitudeInput.value && !longitudeInput.value) continue;
        if (!latitudeInput.value || !longitudeInput.value ||
            !latitudeInput.validity.valid || !longitudeInput.validity.valid ||
            !Number.isFinite(latitudeInput.valueAsNumber) || !Number.isFinite(longitudeInput.valueAsNumber)) {
          warnings.push(`${label} coordinates are incomplete or invalid.`);
          continue;
        }
        try {
          const point = planner.validatePoint({
            latitude: latitudeInput.valueAsNumber,
            longitude: longitudeInput.valueAsNumber
          }, `${label} point`);
          if (!regionalTerrain.sample(point).valid) {
            warnings.push(`${label} point is outside the selected DEM coverage.`);
            continue;
          }
          points[which === 'dest' ? 'destination' : 'start'] = point;
        } catch (error) {
          warnings.push(`${label} point cannot be marked: ${error.message}`);
        }
      }
    }
    routeScene.setEndpointMarkers(points.start, points.destination);
    pilotScene?.setEndpointMarkers(points.start, points.destination);
    for (const { scene } of auxiliaryViews.values()) {
      scene.setEndpointMarkers(points.start, points.destination);
    }
    if (warnings.length) setSelectionStatus(warnings[0], true);
    return warnings;
  }

  function updateJourneyControls() {
    const region = selectedRegion();
    const terrainReady = Boolean(localSceneActive && regionalTerrain &&
      region && regionalTerrain.region.id === region.id);
    const coordinatesValid = [...$('marswalk-coordinate-form').querySelectorAll('input[required]')]
      .every(input => input.value !== '' && input.validity.valid);
    $('marswalk-plan').disabled = !terrainReady || !coordinatesValid || state === 'planning';
  }

  function resetStats() {
    ['marswalk-distance', 'marswalk-duration', 'marswalk-terrain-max',
      'marswalk-flight-max', 'marswalk-min-clearance', 'marswalk-coverage',
      'marswalk-direct-distance',
      'marswalk-deviation', 'marswalk-ascent', 'marswalk-current-position',
      'marswalk-remaining', 'marswalk-current-terrain']
      .forEach(id => { $(id).textContent = '—'; });
    $('marswalk-route-details').hidden = true;
    $('marswalk-route-details').open = false;
    $('marswalk-route-summary').hidden = true;
    $('marswalk-progress').value = '0';
    $('marswalk-progress-value').textContent = '0%';
    $('marswalk-point-data').textContent = 'Endpoint elevation and source details appear after route sampling.';
  }

  function removeRouteEntities() {
    routeScene.clearRoute();
    pilotScene?.clearRoute();
    for (const { scene } of auxiliaryViews.values()) scene.clearRoute();
    for (const entity of entities.splice(0)) viewer.entities.remove(entity);
    baselineEntity = null;
    plannedEntity = null;
    completedEntity = null;
    currentEntity = null;
  }

  function removeLocalTerrain() {
    routeScene.destroy();
    destroyAuxiliaryViews();
    destroyPilotView();
    if (localTerrainPrimitive) viewer.scene.primitives.remove(localTerrainPrimitive);
    localTerrainPrimitive = null;
    regionalTerrain = null;
    currentSurfaceCanvas = null;
  }

  function restoreGlobeScene() {
    removeLocalTerrain();
    if (!localSceneActive) return;
    viewer.scene.globe.show = priorGlobeVisibility;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = priorSkyboxVisibility;
    localSceneActive = false;
    if (cameraSnapshot) {
      viewer.camera.setView({
        destination: cameraSnapshot.position,
        orientation: { direction: cameraSnapshot.direction, up: cameraSnapshot.up }
      });
    }
    viewer.scene.requestRender();
  }

  function clearPlan(message = 'Set two endpoints and plan a route to preview the journey.', preserveTerrain = false) {
    requestId++;
    requests.abortAll();
    stopAnimation();
    releaseCameraControl();
    plan = null;
    planStale = false;
    progress = 0;
    state = 'open';
    setFlightInterface(false, true);
    removeRouteEntities();
    $('marswalk-pilot-frame').hidden = true;
    if (!preserveTerrain) restoreGlobeScene();
    resetTerrainInspection();
    resetStats();
    updatePlaybackControls();
    setStatus(message);
    updateEndpointMarkers();
  }

  function localCartesian(point, clearanceM = 0) {
    const position = regionalTerrain.localPosition(point, clearanceM);
    return new C.Cartesian3(position.x, position.y, position.z);
  }

  function stableCameraBasis(direction) {
    const basis = planner.computeCameraBasis([direction.x, direction.y, direction.z]);
    return {
      direction: new C.Cartesian3(...basis.direction),
      right: new C.Cartesian3(...basis.right),
      up: new C.Cartesian3(...basis.up)
    };
  }

  function showLocalTerrain(terrain, surfaceCanvas) {
    removeLocalTerrain();
    if (!localSceneActive) {
      priorGlobeVisibility = viewer.scene.globe.show;
      priorSkyboxVisibility = viewer.scene.skyBox?.show ?? true;
    }
    routeScene.showTerrain(terrain, surfaceCanvas, wireframeEnabled);
    currentSurfaceCanvas = surfaceCanvas;
    $('marswalk-camera-hud').hidden = false;
    localTerrainPrimitive = { destroy: () => routeScene.destroy() };
    regionalTerrain = terrain;
    localSceneActive = true;
    updateEndpointMarkers();
    viewer.scene.requestRender();
  }

  function createRouteEntities() {
    removeRouteEntities();
    pilotScene?.setRoute(plan.trajectory, regionalTerrain, false);
    for (const { scene } of auxiliaryViews.values()) scene.setRoute(plan.trajectory, regionalTerrain);
    const trajectory = plan.trajectory;
    const start = trajectory[0];
    const destination = trajectory.at(-1);
    const directPositions = [
      localCartesian(trajectory[0], 80),
      localCartesian(trajectory.at(-1), 80)
    ];
    baselineEntity = viewer.entities.add({
      name: 'MarsWalk direct surface projection',
      polyline: {
        positions: directPositions, width: 2, arcType: C.ArcType.NONE, clampToGround: false,
        material: new C.PolylineDashMaterialProperty({
          color: C.Color.fromCssColorString('#dfe6ed').withAlpha(0.78), dashLength: 12
        })
      }
    });
    entities.push(baselineEntity);
    routeScene.setEndpointMarkers(start, destination);
    currentEntity = viewer.entities.add({
      name: 'MarsWalk drone',
      position: localCartesian(start, start.clearanceM),
      point: { pixelSize: 14, color: C.Color.fromCssColorString('#5fe3dc'), outlineColor: C.Color.WHITE, outlineWidth: 2 },
      label: { text: 'DRONE', font: 'bold 10px sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK,
        outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), disableDepthTestDistance: 1e7 }
    });
    entities.push(currentEntity);
    plannedEntity = viewer.entities.add({
      name: 'MarsWalk terrain-aware flight path',
      polyline: {
        positions: trajectory.map(point => localCartesian(point, point.clearanceM)), width: 5, arcType: C.ArcType.NONE, clampToGround: false,
        material: new C.PolylineGlowMaterialProperty({
          glowPower: 0.1, color: C.Color.fromCssColorString('#ffc278')
        })
      }
    });
    completedEntity = viewer.entities.add({
      name: 'MarsWalk completed flight path',
      polyline: {
        positions: trajectory.slice(0, 1).map(point => localCartesian(point, point.clearanceM)), width: 7, arcType: C.ArcType.NONE, clampToGround: false,
        material: new C.PolylineGlowMaterialProperty({
          glowPower: 0.12, color: C.Color.fromCssColorString('#5fe3dc')
        })
      }
    });
    entities.push(plannedEntity, completedEntity);
  }

  function flyToPreview() {
    if (!plan) return;
    const start = localCartesian(plan.trajectory[0], plan.trajectory[0].clearanceM + 12000);
    const end = localCartesian(plan.trajectory.at(-1), plan.trajectory.at(-1).clearanceM + 12000);
    const direction = C.Cartesian3.normalize(C.Cartesian3.subtract(end, start, new C.Cartesian3()), new C.Cartesian3());
    const position = C.Cartesian3.subtract(start,
      C.Cartesian3.multiplyByScalar(direction, 7000, new C.Cartesian3()), new C.Cartesian3());
    direction.z = -0.22;
    const basis = stableCameraBasis(direction);
    routeScene.setCameraPose(position, basis.direction, 0, true);
    viewer.scene.requestRender();
  }

  function updateDiagnostics() {
    $('marswalk-distance').textContent = `${plan.routeDistanceKm.toFixed(1)} km`;
    $('marswalk-direct-distance').textContent = `${plan.directDistanceKm.toFixed(1)} km`;
    updateDisplayedDuration();
    $('marswalk-terrain-max').textContent = `${formatNumber(plan.maximumTerrainElevationM)} m above MOLA GMM3 areoid`;
    $('marswalk-flight-max').textContent = `${formatNumber(plan.maximumFlightElevationM)} m above reference ellipsoid`;
    $('marswalk-min-clearance').textContent = `${formatNumber(plan.minimumClearanceM)} m above sampled terrain`;
    $('marswalk-deviation').textContent = `${plan.maximumDeviationKm.toFixed(1)} km from direct path`;
    $('marswalk-ascent').textContent = `${formatNumber(plan.ascentM)} m up · ${formatNumber(plan.descentM)} m down`;
    $('marswalk-coverage').textContent =
      `${plan.dataset.resolutionMetersAtEquator} m nominal at equator · ${plan.sampleCount} trajectory samples`;
    const startSample = plan.trajectory[0].terrain;
    const endSample = plan.trajectory.at(-1).terrain;
    $('marswalk-point-data').textContent =
      `Start ${formatNumber(startSample.elevationM)} m · destination ${formatNumber(endSample.elevationM)} m above GMM3 areoid. ` +
      `${startSample.dataset} · ${startSample.resolutionMetersAtEquator} m nominal at equator.`;
    $('marswalk-route-summary').hidden = false;
    $('marswalk-route-details').hidden = false;
    setStatus(`Route ready · ${plan.modeLabel} · ${regionalTerrain.region.name}.${imageryWarning ? ` ${imageryWarning}` : ''}`,
      Boolean(imageryWarning));
  }

  function updatePlaybackControls() {
    const hasPlan = Boolean(plan);
    const playable = hasPlan && !planStale;
    $('marswalk-progress').disabled = !playable;
    $('marswalk-play').disabled = !playable || state === 'playing';
    $('marswalk-play').textContent = state === 'complete' ? 'Start Again' :
      state === 'paused' ? 'Resume' : 'Start Journey';
    $('marswalk-flight-pause').textContent = state === 'paused' ? 'Resume' : 'Pause';
  }

  function updateDisplayedDuration() {
    if (plan) $('marswalk-duration').textContent =
      `${(plan.durationSeconds / playbackSpeed).toFixed(0)} s at ${playbackSpeed}×`;
  }

  function setPlaybackSpeed(value) {
    const speed = Number(value);
    if (!navigation.SPEED_OPTIONS.includes(speed)) {
      $('marswalk-speed').value = String(playbackSpeed);
      $('marswalk-flight-speed').value = String(playbackSpeed);
      setStatus(`Unsupported flight speed: ${value}. Choose one of the listed playback rates.`, true);
      return;
    }
    playbackSpeed = speed;
    $('marswalk-speed').value = String(speed);
    $('marswalk-flight-speed').value = String(speed);
    updateDisplayedDuration();
  }

  function updateCurrentPosition(cameraDeltaSeconds = 0, cameraSnap = true) {
    if (!plan) return;
    const sample = planner.sampleTrajectory(plan.trajectory, progress);
    const cartesian = localCartesian(sample, sample.clearanceM);
    currentEntity.position = cartesian;
    if (completedEntity) {
      const sampleIndex = sample.index;
      const positions = plan.trajectory.slice(0, sampleIndex + 1)
        .map(point => localCartesian(point, point.clearanceM));
      if (progress > 0 && sampleIndex < plan.trajectory.length - 1) positions.push(cartesian);
      completedEntity.polyline.positions = positions;
    }
    const percentage = Math.round(progress * 100);
    $('marswalk-progress').value = String(Math.round(progress * 1000));
    $('marswalk-progress-value').textContent = `${percentage}%`;
    $('marswalk-current-position').textContent =
      `${sample.latitude.toFixed(3)}°, ${formatInspectionLongitude(sample.longitude, 3)}`;
    $('marswalk-remaining').textContent = `${Math.max(0, plan.routeDistanceKm - sample.distanceKm).toFixed(1)} km`;
    $('marswalk-current-terrain').textContent =
      `${Math.round(sample.terrain.elevationM).toLocaleString()} m · ${Math.round(sample.clearanceM).toLocaleString()} m clearance`;
    pilotScene?.updateProgress(progress, plan.trajectory, cameraDeltaSeconds, cameraSnap);
    renderPilotView(cameraSnap || state === 'complete');
    for (const view of auxiliaryViews.values()) {
      view.scene.updateProgress(progress, plan.trajectory, cameraDeltaSeconds, cameraSnap, view.mode);
      if (!renderAuxiliaryView(view, cameraSnap || state === 'complete')) destroyAuxiliaryView(view);
    }
    if (state === 'playing' || state === 'paused' || state === 'complete') {
      setCameraAtProgress(progress, cameraDeltaSeconds, cameraSnap);
    }
  }

  function setCameraAtProgress(fraction, deltaSeconds = 0, snap = false) {
    if (!plan || !regionalTerrain) return;
    const current = planner.sampleTrajectory(plan.trajectory, fraction);
    const index = current.index;
    const dronePosition = localCartesian(current, current.clearanceM);
    const lookAhead = planner.sampleTrajectory(plan.trajectory, Math.min(1, fraction + 0.06));
    const previous = localCartesian(plan.trajectory[Math.max(0, index - 2)],
      plan.trajectory[Math.max(0, index - 2)].clearanceM);
    const future = localCartesian(lookAhead, lookAhead.clearanceM);
    const forward = C.Cartesian3.subtract(future, previous, new C.Cartesian3());
    if (C.Cartesian3.magnitudeSquared(forward) < 1e-8) forward.x = 1;
    C.Cartesian3.normalize(forward, forward);

    const side = new C.Cartesian3(-forward.y, forward.x, 0);
    if (C.Cartesian3.magnitudeSquared(side) < 1e-8) side.y = 1;
    C.Cartesian3.normalize(side, side);
    const remainingKm = Math.max(0, plan.routeDistanceKm - current.distanceKm);
    const distance = Math.max(8500, Math.min(30000, remainingKm * 420));
    const position = new C.Cartesian3(
      dronePosition.x - forward.x * distance * 0.68 + side.x * distance * 0.34,
      dronePosition.y - forward.y * distance * 0.68 + side.y * distance * 0.34,
      dronePosition.z + distance * 0.48
    );
    if (routeScene.terrainMesh) {
      position.z = Math.max(position.z, routeScene.terrainMesh.maximumElevationM + 2500);
    }

    const lookDirection = C.Cartesian3.subtract(future, position, new C.Cartesian3());
    lookDirection.z += Math.max(-1800, Math.min(1800, lookAhead.clearanceM - current.clearanceM)) * 0.18;
    C.Cartesian3.normalize(lookDirection, lookDirection);
    routeScene.setCameraPose(position, lookDirection, reducedMotion ? deltaSeconds * 1.5 : deltaSeconds, snap);
  }

  function captureCamera() {
    const camera = viewer.camera;
    cameraSnapshot = {
      position: C.Cartesian3.clone(camera.positionWC),
      direction: C.Cartesian3.clone(camera.directionWC),
      up: C.Cartesian3.clone(camera.upWC)
    };
  }

  function enterCameraControl() {
    if (previousEnableInputs !== null) return;
    previousEnableInputs = viewer.scene.screenSpaceCameraController.enableInputs;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    routeScene.setNavigationEnabled(false);
  }

  function releaseCameraControl() {
    if (previousEnableInputs !== null && !viewer.isDestroyed()) {
      viewer.scene.screenSpaceCameraController.enableInputs = previousEnableInputs;
      previousEnableInputs = null;
    }
    routeScene.setNavigationEnabled(state !== 'playing');
    if (state !== 'playing') routeScene.syncNavigationFromCamera();
  }

  function stopAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    lastFrameTime = null;
  }

  function finishPlayback() {
    stopAnimation();
    progress = 1;
    state = 'complete';
    updateCurrentPosition(1 / 60, false);
    releaseCameraControl();
    setFlightInterface(false);
    setStatus('Journey complete. The planned route and destination remain visible; replay or return to preview.');
    updatePlaybackControls();
  }

  function tick(now) {
    if (state !== 'playing') return;
    if (lastFrameTime === null) lastFrameTime = now;
    const elapsedSeconds = Math.max(0, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    progress = navigation.advanceProgress(progress, elapsedSeconds, playbackSpeed, plan.durationSeconds);
    updateCurrentPosition(Math.min(elapsedSeconds, 0.1), false);
    if (progress >= 1) {
      finishPlayback();
      return;
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function play() {
    if (!plan || planStale || state === 'playing') return;
    if (state === 'complete') progress = 0;
    state = 'playing';
    setFlightInterface(true);
    const pilotReady = ensurePilotView();
    const topReady = ensureAuxiliaryView('top');
    const sideReady = ensureAuxiliaryView('side');
    $('marswalk-pilot-frame').hidden = !pilotReady;
    enterCameraControl();
    updateCurrentPosition(1 / 60, false);
    const missingViews = [
      !pilotReady && (pilotViewError || 'pilot view unavailable'),
      !topReady && 'top view unavailable',
      !sideReady && 'side view unavailable'
    ].filter(Boolean);
    setStatus(missingViews.length
      ? `Journey in progress · available cameras share the same flight state. Missing: ${missingViews.join(', ')}.`
      : 'Journey in progress · all four camera views share the same flight state.',
    Boolean(missingViews.length));
    updatePlaybackControls();
    animationFrame = requestAnimationFrame(tick);
  }

  function pause() {
    if (state !== 'playing') return;
    stopAnimation();
    state = 'paused';
    releaseCameraControl();
    setStatus('Journey paused. Resume continues from the current position; the route remains visible.');
    updatePlaybackControls();
  }

  function stop() {
    if (!plan) return;
    stopAnimation();
    releaseCameraControl();
    progress = 0;
    state = 'preview';
    setFlightInterface(false, true);
    $('marswalk-pilot-frame').hidden = true;
    updateCurrentPosition();
    flyToPreview();
    setStatus('Journey stopped. The route preview remains ready to play.');
    updatePlaybackControls();
  }

  function restart() {
    if (!plan || planStale) return;
    stopAnimation();
    progress = 0;
    state = 'preview';
    updateCurrentPosition();
    play();
  }

  function clearSelectionMode() {
    removeSelectionHandler?.();
    removeSelectionHandler = null;
    selectionPoint = 0;
    routeScene.setNavigationEnabled(localSceneActive && state !== 'playing');
    $('marswalk-select-points').setAttribute('aria-pressed', 'false');
    $('marswalk-select-points').textContent = 'Select points on terrain';
    $('cesiumContainer').classList.remove('marswalk-selecting');
  }

  function beginPointSelection() {
    if (!active()) return;
    if (!selectedRegion()) {
      setSelectionStatus('Choose one of the bundled regional DEM patches before selecting endpoints.', true);
      return;
    }
    clearSelectionMode();
    clearPlan(
      'Choose two points on the selected regional DEM to create a route preview.',
      localSceneActive
    );
    selectionPoint = 1;
    if (localSceneActive) {
      routeScene.setNavigationEnabled(false);
      setSelectionStatus('Click the visible regional DEM terrain to select the start point.');
      $('marswalk-select-points').setAttribute('aria-pressed', 'true');
      $('marswalk-select-points').textContent = 'Selecting start…';
      $('cesiumContainer').classList.add('marswalk-selecting');
      return;
    }

    setSelectionStatus('Click Mars to select the start point. A mission marker can also be selected.');
    $('marswalk-select-points').setAttribute('aria-pressed', 'true');
    $('marswalk-select-points').textContent = 'Selecting start…';
    $('cesiumContainer').classList.add('marswalk-selecting');
    removeSelectionHandler = globe.setMarsWalkSelectionHandler(point => {
      if (selectionPoint === 1) {
        writeCoordinate('start', point);
        selectionName = point.name || null;
        selectionPoint = 2;
        setSelectionStatus(`Start selected${selectionName ? ` · ${selectionName}` : ''}. Click Mars for the destination.`);
        $('marswalk-select-points').textContent = 'Selecting destination…';
        return;
      }
      writeCoordinate('dest', point);
      const destinationName = point.name || null;
      clearSelectionMode();
      setSelectionStatus(`Endpoints selected${destinationName ? ` · ${destinationName}` : ''}. Planning a route preview; playback will not start automatically.`);
      planRoute();
    });
  }

  function getGrid() {
    if (grid) return Promise.resolve(grid);
    if (gridPromise) return gridPromise;
    let pendingGrid;
    pendingGrid = Promise.all([
      requests.read('data/mola-meg004-topography.img', 'arrayBuffer'),
      requests.read('data/mola-meg004-areoid-radius-offset.img', 'arrayBuffer')
    ]).then(([topography, areoid]) => {
      grid = science.decodeMola(topography, areoid);
      return grid;
    }).catch(error => {
      if (gridPromise === pendingGrid) gridPromise = null;
      throw new Error(`Bundled MOLA terrain could not be loaded: ${error.message}`);
    });
    gridPromise = pendingGrid;
    return pendingGrid;
  }

  function selectedRegion() {
    return terrainModel.REGIONS.find(region => region.id === $('marswalk-region').value) || null;
  }

  async function getRegionalTerrain(region, datumGrid) {
    let patchPromise = patchCache.get(region.id);
    if (!patchPromise) {
      let pendingPatch;
      pendingPatch = requests.read(region.file, 'arrayBuffer')
        .then(buffer => terrainModel.decodePatch(buffer))
        .catch(error => {
          if (patchCache.get(region.id) === pendingPatch) patchCache.delete(region.id);
          throw new Error(`Regional MOLA terrain could not be loaded for ${region.name}: ${error.message}`);
        });
      patchPromise = pendingPatch;
      patchCache.set(region.id, pendingPatch);
    }
    const patch = await patchPromise;
    return terrainApi.createRegionalTerrain(region, patch, datumGrid, science);
  }

  async function getRegionalImagery(region) {
    const request = terrainApi.createImageryRequest(region, science);
    if (!request) {
      return {
        request: null,
        bitmap: null,
        warning: 'The USGS MOLA/THEMIS blend does not cover this patch; using elevation-derived colors.'
      };
    }
    try {
      const blob = await requests.read(request.url, 'blob');
      if (!blob.type.startsWith('image/')) throw new Error('The imagery service returned a non-image response.');
      return { request, bitmap: await createImageBitmap(blob), warning: '' };
    } catch (error) {
      return {
        request,
        bitmap: null,
        warning: `MOLA/THEMIS imagery could not be loaded (${error.message}); using elevation-derived colors.`
      };
    }
  }

  async function createSurfaceForMode(terrain, mode) {
    if (mode === 'terrain-explorer') {
      return {
        surfaceCanvas: terrainModel.createExplorerTexture(
          terrain.patch, terrain.region.halfExtentKm * 2, terrain.patch.size
        ),
        request: null,
        warning: '',
        imageryApplied: false
      };
    }

    const imagery = mode === 'imagery'
      ? await getRegionalImagery(terrain.region)
      : { request: null, bitmap: null, warning: '' };
    try {
      const surfaceCanvas = terrainApi.createSurfaceTexture(terrain, imagery.bitmap);
      return {
        surfaceCanvas,
        request: imagery.bitmap ? imagery.request : null,
        warning: imagery.warning,
        imageryApplied: Boolean(imagery.bitmap)
      };
    } catch (error) {
      if (mode !== 'imagery') throw error;
      return {
        surfaceCanvas: terrainApi.createSurfaceTexture(terrain),
        request: null,
        warning: `MOLA/THEMIS surface imagery could not be prepared (${error.message}); using elevation-derived colors.`,
        imageryApplied: false
      };
    } finally {
      imagery.bitmap?.close();
    }
  }

  function displayModeName(mode) {
    return mode === 'imagery' ? 'MOLA/THEMIS' :
      mode === 'terrain-explorer' ? 'Terrain Explorer' : 'Elevation Only';
  }

  function syncSurfaceStyleControl(mode) {
    for (const input of document.querySelectorAll('input[name="marswalk-surface-style"]')) {
      input.checked = input.value === mode;
    }
  }

  function reflectFlightProfile(mode) {
    $('marswalk-mode').value = mode;
    for (const input of document.querySelectorAll('input[name="marswalk-profile"]')) {
      input.checked = input.value === mode;
    }
    $('marswalk-profile-label').textContent = mode === 'custom' ? 'Custom values' : `${modeDefaults[mode].label} defaults`;
  }

  function applyFlightProfile(mode, updateValues = true) {
    reflectFlightProfile(mode);
    if (updateValues && mode !== 'custom') {
      $('marswalk-clearance').value = String(modeDefaults[mode].clearanceM);
      $('marswalk-clearance-value').textContent = `${formatNumber(modeDefaults[mode].clearanceM)} m`;
      $('marswalk-max-altitude').value = String(modeDefaults[mode].maxHeightM);
      $('marswalk-smoothness').value = String(modeDefaults[mode].smoothness);
      $('marswalk-smoothness-value').textContent = modeDefaults[mode].smoothness.toFixed(2);
    }
  }

  function markCustomProfileStale() {
    reflectFlightProfile('custom');
    markPlanStale();
  }

  function setDisplayStatus(message, warning = false) {
    $('marswalk-display-status').textContent = message;
    $('marswalk-display-status').classList.toggle('warning', warning);
  }

  function updateTerrainSourceNote(request = null, warning = '', mode = displayMode) {
    const terrain = regionalTerrain;
    if (!terrain) return;
    const coverage = terrainApi.getCoverageBounds(terrain.region, science);
    const formatLongitude = longitude => formatInspectionLongitude(longitude, 3);
    const imageryDescription = request
      ? `Surface image: ${request.name}, THEMIS IR Day at ${request.resolutionMeters} m/pixel nominal; the semi-controlled image may be slightly misregistered.`
      : mode === 'imagery'
        ? 'Elevation-only colouring from the regional MOLA DEM; no usable WMS image is available.'
        : mode === 'terrain-explorer'
          ? 'Terrain Explorer style: bundled MOLA elevations use the same palette and triangle-edge treatment as Terrain Explorer; no imagery service is used.'
          : 'Elevation-only colouring from the regional MOLA DEM; no WMS request is made.';
    $('marswalk-source-note').textContent =
      `${warning ? `${warning} ` : ''}${imageryDescription} Mesh and route use bundled MOLA MEGDR 128 pixels/degree. ` +
      `Coverage center ${coverage.centerLatitude.toFixed(3)}°, ${formatLongitude(coverage.centerLongitude)} · ` +
      `${coverage.southLatitude.toFixed(3)}°–${coverage.northLatitude.toFixed(3)}° latitude · ` +
      `${formatLongitude(coverage.westLongitude)}–${formatLongitude(coverage.eastLongitude)} longitude.`;
    $('marswalk-mesh-info').textContent =
      `DEM posting: ${terrain.source.resolutionMetersAtEquator} m nominal at equator · Mesh: ${terrain.patch.size} × ${terrain.patch.size} vertices, ${terrain.patch.size - 1} × ${terrain.patch.size - 1} cells.`;
  }

  async function applyTerrainDisplayMode(requestedMode = $('marswalk-display-mode').value) {
    const terrain = regionalTerrain;
    if (!terrain || !localSceneActive) {
      displayMode = requestedMode;
      syncSurfaceStyleControl(displayMode);
      setDisplayStatus(`${displayModeName(displayMode)} selected. The existing DEM geometry is unchanged.`);
      return;
    }
    const thisDisplayRequest = ++displayRequestId;
    setDisplayStatus(`Loading ${displayModeName(requestedMode)} surface style… The current appearance remains visible.`);
    try {
      const surface = await createSurfaceForMode(terrain, requestedMode);
      if (!localSceneActive || terrain !== regionalTerrain || thisDisplayRequest !== displayRequestId) return;
      routeScene.setSurfaceTexture(surface.surfaceCanvas);
      currentSurfaceCanvas = surface.surfaceCanvas;
      pilotScene?.setSurfaceTexture(surface.surfaceCanvas);
      for (const { scene } of auxiliaryViews.values()) scene.setSurfaceTexture(surface.surfaceCanvas);
      renderPilotView(true);
      for (const view of auxiliaryViews.values()) renderAuxiliaryView(view, true);
      displayMode = requestedMode;
      syncSurfaceStyleControl(displayMode);
      updateTerrainSourceNote(surface.request, surface.warning, requestedMode);
      setDisplayStatus(
        surface.warning
          ? `${displayModeName(requestedMode)} selected with a warning: ${surface.warning}`
          : `${displayModeName(requestedMode)} surface style active. DEM geometry, route, and flight state are unchanged.`,
        Boolean(surface.warning)
      );
    } catch (error) {
      if (thisDisplayRequest !== displayRequestId) return;
      $('marswalk-display-mode').value = displayMode;
      syncSurfaceStyleControl(displayMode);
      setDisplayStatus(
        `Could not load ${displayModeName(requestedMode)} surface style: ${error.message}. ` +
        `The previous ${displayModeName(displayMode)} appearance is still active.`,
        true
      );
    }
  }

  function inspectTerrainClick(event) {
    if (!localSceneActive || !regionalTerrain) return;
    const position = routeScene.pickTerrainPosition(event.position);
    if (!position) return;
    const reading = regionalTerrain.inspectLocalPosition(position);
    if (!reading) return;
    if (selectionPoint) {
      selectLocalEndpoint(reading);
      return;
    }
    $('marswalk-inspect-lat').textContent = `${reading.latitude.toFixed(5)}°`;
    $('marswalk-inspect-lon').textContent = formatInspectionLongitude(reading.longitude);
    $('marswalk-inspect-elevation').textContent = `${reading.sampleElevationM.toFixed(1)} m`;
    $('marswalk-inspect-local-height').textContent = `${reading.localHeightM.toFixed(1)} m`;
    $('marswalk-inspect-mesh-delta').textContent = `${reading.meshSampleDeltaM >= 0 ? '+' : ''}${reading.meshSampleDeltaM.toFixed(2)} m`;
    $('marswalk-inspect-render-delta').textContent =
      `${(position.z - reading.meshLocalHeightM >= 0 ? '+' : '')}${(position.z - reading.meshLocalHeightM).toFixed(2)} m`;
    $('marswalk-inspection-help').textContent =
      'Route samples and terrain inspection use the mesh triangles directly, so mesh/query difference should be near zero. Picked-surface difference reports ray-pick alignment.';
    $('marswalk-inspection-values').hidden = false;
    $('marswalk-inspection-help').hidden = false;
    $('marswalk-inspection-details').hidden = false;
    $('marswalk-inspection-details').open = true;
  }

  function resetTerrainInspection() {
    for (const id of [
      'marswalk-inspect-lat', 'marswalk-inspect-lon', 'marswalk-inspect-elevation',
      'marswalk-inspect-local-height', 'marswalk-inspect-mesh-delta',
      'marswalk-inspect-render-delta'
    ]) $(id).textContent = '—';
    $('marswalk-inspection-help').textContent =
      'Click a visible terrain triangle to inspect its DEM sample, patch-relative height, and interpolation differences.';
    $('marswalk-inspection-values').hidden = true;
    $('marswalk-inspection-help').hidden = true;
    $('marswalk-inspection-details').open = false;
    $('marswalk-inspection-details').hidden = true;
  }

  function showRegionCoverage(region) {
    const coverage = terrainApi.getCoverageBounds(region, science);
    const formatLongitude = longitude => {
      const wrapped = normalizedLongitude(longitude);
      return `${Math.abs(wrapped).toFixed(3)}°${wrapped < 0 ? 'W' : 'E'}`;
    };
    setSelectionStatus(`${coverage.name} · ${coverage.widthKm.toFixed(0)} km coverage.`);
    $('marswalk-source-note').textContent =
      `${coverage.sourceProduct} · center ${coverage.centerLatitude.toFixed(3)}°, ${formatLongitude(coverage.centerLongitude)} · ` +
      `${coverage.southLatitude.toFixed(3)}°–${coverage.northLatitude.toFixed(3)}° latitude · ` +
      `${formatLongitude(coverage.westLongitude)}–${formatLongitude(coverage.eastLongitude)} longitude.`;
    return coverage;
  }

  async function loadCoverageTerrain(region) {
    const thisCoverageRequest = ++coverageRequestId;
    if (!grid) gridPromise = null;
    patchCache.clear();
    clearPlan('Loading selected regional MOLA coverage…');
    resetTerrainInspection();
    if (!region) {
      $('marswalk-source-note').textContent =
        'Terrain: bundled regional MOLA MEGDR, 128 pixels/degree. Select a coverage to display its numerical DEM mesh.';
      $('marswalk-mesh-info').textContent = 'DEM posting and mesh dimensions appear after a regional patch is loaded.';
      setStatus('No regional DEM coverage selected.');
      setSelectionStatus('Choose a supported regional DEM patch to load its terrain.');
      return;
    }
    let coverage;
    try {
      coverage = showRegionCoverage(region);
      setStatus(`Loading ${coverage.name} DEM (${coverage.dataFile}); generating the ${coverage.patchSize} × ${coverage.patchSize} terrain mesh…`);
      $('marswalk-source-note').textContent = `Loading numerical MOLA DEM from ${coverage.dataFile}…`;
      $('marswalk-mesh-info').textContent = `Loading ${coverage.patchSize} × ${coverage.patchSize} DEM samples and generating terrain geometry…`;
      const datumGrid = await getGrid();
      const terrain = await getRegionalTerrain(region, datumGrid);
      let requestedDisplayMode = $('marswalk-display-mode').value;
      let surface = await createSurfaceForMode(terrain, requestedDisplayMode);
      while ($('marswalk-display-mode').value !== requestedDisplayMode) {
        requestedDisplayMode = $('marswalk-display-mode').value;
        surface = await createSurfaceForMode(terrain, requestedDisplayMode);
      }
      if (!active() || thisCoverageRequest !== coverageRequestId ||
          selectedRegion()?.id !== region.id) {
        return;
      }

      regionalTerrain = terrain;
      imageryWarning = surface.warning;
      displayMode = requestedDisplayMode;
      $('marswalk-display-mode').value = displayMode;
      syncSurfaceStyleControl(displayMode);
      showLocalTerrain(terrain, surface.surfaceCanvas);
      routeScene.resetView();
      updateTerrainSourceNote(surface.request, surface.warning, displayMode);
      setDisplayStatus(
        surface.warning
          ? `${displayModeName(displayMode)} loaded with a warning: ${surface.warning}`
          : `${displayModeName(displayMode)} surface style active.`,
        Boolean(surface.warning)
      );
      setStatus(
        `Terrain loaded · ${coverage.name}. Select journey points or enter coordinates.`,
        Boolean(surface.warning)
      );
      updateJourneyControls();
    } catch (error) {
      if (thisCoverageRequest !== coverageRequestId || !active()) return;
      removeRouteEntities();
      removeLocalTerrain();
      restoreGlobeScene();
      if (!region.file) {
        setStatus(`Missing DEM data for ${region.name}: no bundled elevation file is configured.`, true);
      } else if (!coverage && error instanceof RangeError) {
        setStatus(`Unsupported geographic coverage for ${region.name}: ${error.message}`, true);
      } else {
        setStatus(
          `DEM loading failed for ${region.name} (${region.file || 'no bundled file configured'}): ${error.message}. ` +
          'The selected patch may be missing, unreadable, or invalid; no other region was substituted.',
          true
        );
      }
      updateJourneyControls();
    }
  }

  function selectLocalEndpoint(reading) {
    const which = selectionPoint === 1 ? 'start' : 'dest';
    const point = { latitude: reading.latitude, longitude: reading.longitude };
    writeCoordinate(which, point);
    if (selectionPoint === 1) {
      selectionPoint = 2;
      setSelectionStatus(
        `Start selected at ${point.latitude.toFixed(4)}°, ${formatInspectionLongitude(point.longitude)} · ` +
        `${reading.sampleElevationM.toFixed(1)} m MOLA. Click the terrain for the destination.`
      );
      $('marswalk-select-points').textContent = 'Selecting destination…';
      return;
    }
    clearSelectionMode();
    setSelectionStatus(`Start and destination selected · ${regionalTerrain.region.name}.`);
    setStatus('Endpoints ready · plan a route to continue.');
    updateJourneyControls();
  }

  async function planRoute(event) {
    event?.preventDefault();
    if (!active()) return;
    clearSelectionMode();
    const thisRequest = ++requestId;
    stopAnimation();
    releaseCameraControl();
    plan = null;
    planStale = false;
    removeRouteEntities();
    resetStats();
    state = 'planning';
    updatePlaybackControls();
    $('marswalk-plan').disabled = true;
    resetTerrainInspection();
    const requestedDisplayMode = $('marswalk-display-mode').value;
    setStatus(requestedDisplayMode === 'imagery'
      ? 'Loading the selected regional MOLA DEM, areoid reference, and optional surface imagery…'
      : 'Loading the selected regional MOLA DEM and areoid reference; no WMS imagery is needed for this surface style…');
    try {
      const points = coordinateFields();
      const region = selectedRegion();
      if (!region) throw new RangeError('Choose a supported regional DEM patch before planning.');
      writeCoordinate('start', points.start);
      writeCoordinate('dest', points.destination);
      const datumGrid = await getGrid();
      const terrain = await getRegionalTerrain(region, datumGrid);
      let loadedDisplayMode = requestedDisplayMode;
      let surface = await createSurfaceForMode(terrain, loadedDisplayMode);
      if (!active() || thisRequest !== requestId) return;
      while (loadedDisplayMode !== $('marswalk-display-mode').value) {
        loadedDisplayMode = $('marswalk-display-mode').value;
        surface = await createSurfaceForMode(terrain, loadedDisplayMode);
        if (!active() || thisRequest !== requestId) return;
      }
      regionalTerrain = terrain;
      displayMode = loadedDisplayMode;
      imageryWarning = surface.warning;
      setStatus(`Sampling the ${region.name} patch and evaluating bounded local corridor candidates…`);
      const regionalScience = {
        ...science,
        sampleElevation: (_grid, latitude, longitude) => terrain.sample({ latitude, longitude })
      };
      const preferences = {
        mode: $('marswalk-mode').value,
        clearanceM: Number($('marswalk-clearance').value),
        maxHeightM: Number($('marswalk-max-altitude').value),
        smoothness: Number($('marswalk-smoothness').value),
        sampleSpacingKm: 1.5,
        dataset: terrain.source
      };
      const newPlan = planner.planRoute(datumGrid, regionalScience, points.start, points.destination, preferences);
      if (!active() || thisRequest !== requestId) return;
      plan = newPlan;
      progress = 0;
      state = 'preview';
      planStale = false;
      $('marswalk-display-mode').value = displayMode;
      showLocalTerrain(terrain, surface.surfaceCanvas);
      updateTerrainSourceNote(surface.request, surface.warning, displayMode);
      setDisplayStatus(`${displayModeName(displayMode)} surface style active.`);
      createRouteEntities();
      updateDiagnostics();
      updateCurrentPosition();
      updatePlaybackControls();
      flyToPreview();
    } catch (error) {
      if (!active() || thisRequest !== requestId) return;
      state = 'open';
      setStatus(error.message, true);
      updatePlaybackControls();
    } finally {
      $('marswalk-plan').disabled = false;
      updateJourneyControls();
    }
  }

  function open() {
    if (active()) return;
    state = 'open';
    captureCamera();
    $('marswalk-workspace').hidden = false;
    document.body.classList.add('marswalk-open');
    displayMode = 'terrain-explorer';
    $('marswalk-display-mode').value = displayMode;
    syncSurfaceStyleControl(displayMode);
    setPlaybackSpeed(1);
    applyFlightProfile('cinematic');
    $('marswalk-route-details').open = false;
    $('marswalk-advanced-settings').open = false;
    $('marswalk-inspection-details').hidden = true;
    updateEndpointSummary();
    updatePlaybackControls();
    $('open-marswalk').setAttribute('aria-expanded', 'true');
    $('marswalk-region').focus();
    viewer.scene.requestRender();
  }

  function active() {
    return !$('marswalk-workspace').hidden;
  }

  function close(restorePreviousView = false) {
    if (!active()) return;
    clearSelectionMode();
    const snapshot = restorePreviousView || !localSceneActive || !plan
      ? cameraSnapshot
      : cameraSnapshotAtCurrentRoutePosition();
    clearPlan('MarsWalk closed. Open it again to plan another journey.');
    $('marswalk-region').value = '';
    $('marswalk-preset').value = '';
    $('marswalk-coordinate-form').reset();
    updatePresetInfo();
    updateEndpointSummary();
    setSelectionStatus('Choose a region to load its terrain.');
    $('marswalk-workspace').hidden = true;
    $('marswalk-camera-hud').hidden = true;
    document.body.classList.remove('marswalk-open');
    $('open-marswalk').setAttribute('aria-expanded', 'false');
    cameraSnapshot = null;
    if (snapshot && !viewer.isDestroyed()) {
      viewer.camera.flyTo({
        destination: snapshot.position,
        orientation: { direction: snapshot.direction, up: snapshot.up },
        duration: reducedMotion ? 0 : 1
      });
    }
    $('open-marswalk').focus();
  }

  function cameraSnapshotAtCurrentRoutePosition() {
    const current = planner.sampleTrajectory(plan.trajectory, progress);
    const destination = C.Cartesian3.fromDegrees(current.longitude, current.latitude,
      Math.max(8000, current.flightHeightM + 6000), ellipsoid);
    const frame = C.Transforms.eastNorthUpToFixedFrame(destination, ellipsoid);
    const east = C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(frame, 0, new C.Cartesian4()), new C.Cartesian3());
    const north = C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(frame, 1, new C.Cartesian4()), new C.Cartesian3());
    const surfaceUp = C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(frame, 2, new C.Cartesian4()), new C.Cartesian3());
    const index = current.index;
    const previous = regionalTerrain.localPosition(plan.trajectory[Math.max(0, index - 1)]);
    const next = regionalTerrain.localPosition(plan.trajectory[Math.min(plan.trajectory.length - 1, index + 1)]);
    const forwardLength = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
    const eastComponent = (next.x - previous.x) / forwardLength;
    const northComponent = (next.y - previous.y) / forwardLength;
    const direction = C.Cartesian3.add(
      C.Cartesian3.add(
        C.Cartesian3.multiplyByScalar(east, eastComponent, new C.Cartesian3()),
        C.Cartesian3.multiplyByScalar(north, northComponent, new C.Cartesian3()),
        new C.Cartesian3()
      ),
      C.Cartesian3.multiplyByScalar(surfaceUp, -0.2, new C.Cartesian3()),
      new C.Cartesian3()
    );
    const basis = stableCameraBasis(direction);
    return { position: destination, direction: basis.direction, up: basis.up };
  }

  function markPlanStale() {
    if (state === 'planning') {
      requestId++;
      requests.abortAll();
      state = 'open';
      setStatus('Route planning cancelled because an input changed. Plan again when ready.', true);
      updatePlaybackControls();
      return;
    }
    if (!plan) return;
    planStale = true;
    if (state === 'playing') pause();
    setStatus('Flight settings or coordinates changed. Re-plan to update the trajectory before playback.', true);
    updatePlaybackControls();
  }

  function initializePresets() {
    for (const region of terrainModel.REGIONS) {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.name;
      $('marswalk-region').append(option);
    }
    for (const preset of planner.PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      $('marswalk-preset').append(option);
    }
  }

  function updatePresetInfo() {
    const preset = planner.PRESETS.find(item => item.id === $('marswalk-preset').value);
    if (!preset) {
      $('marswalk-preset-info').hidden = true;
      return;
    }
    $('marswalk-preset-info').hidden = false;
    $('marswalk-preset-info').textContent = `${preset.name} · curated exploration in ${preset.region}.`;
  }

  function loadPreset() {
    const preset = planner.PRESETS.find(item => item.id === $('marswalk-preset').value);
    if (!preset) {
      setSelectionStatus('Choose a curated route before loading its endpoints.', true);
      return;
    }
    clearPlan('Preset endpoints loaded. Review the coordinates and plan to create a route preview.');
    $('marswalk-region').value = preset.regionId;
    writeCoordinate('start', preset.start);
    writeCoordinate('dest', preset.destination);
    applyFlightProfile(preset.mode);
    setSelectionStatus(`${preset.name} endpoints loaded. Planning remains under your control.`);
    loadCoverageTerrain(selectedRegion());
  }

  initializePresets();
  updatePresetInfo();
  listen($('open-marswalk'), 'click', open);
  listen($('close-marswalk'), 'click', () => close(false));
  listen($('marswalk-restore-camera'), 'click', () => close(true));
  listen($('marswalk-select-points'), 'click', beginPointSelection);
  listen($('marswalk-coordinate-form'), 'submit', planRoute);
  listen($('marswalk-load-preset'), 'click', loadPreset);
  listen($('marswalk-preset'), 'change', updatePresetInfo);
  for (const input of document.querySelectorAll('input[name="marswalk-surface-style"]')) {
    listen(input, 'change', () => {
      if (!input.checked) return;
      $('marswalk-display-mode').value = input.value;
      applyTerrainDisplayMode(input.value);
    });
  }
  listen($('marswalk-wireframe'), 'change', () => {
    wireframeEnabled = $('marswalk-wireframe').checked;
    routeScene.setWireframe(wireframeEnabled);
    pilotScene?.setWireframe(wireframeEnabled);
    for (const view of auxiliaryViews.values()) {
      view.scene.setWireframe(wireframeEnabled);
      if (!renderAuxiliaryView(view, true)) destroyAuxiliaryView(view);
    }
    renderPilotView(true);
  });
  listen($('marswalk-reset-view'), 'click', () => {
    if (state === 'playing') pause();
    routeScene.resetView();
  });
  listen($('marswalk-region'), 'change', () => {
    clearSelectionMode();
    $('marswalk-coordinate-form').reset();
    updateEndpointSummary();
    $('marswalk-preset').value = '';
    updatePresetInfo();
    loadCoverageTerrain(selectedRegion());
  });
  listen($('marswalk-clear'), 'click', () => {
    clearSelectionMode();
    clearPlan(undefined, localSceneActive);
    $('marswalk-coordinate-form').reset();
    updateEndpointSummary();
    $('marswalk-preset').value = '';
    updatePresetInfo();
    setSelectionStatus('Endpoints cleared. Enter coordinates or select points on the globe.');
  });
  listen($('marswalk-swap'), 'click', () => {
    const start = {
      latitude: $('marswalk-start-lat').value,
      longitude: $('marswalk-start-lon').value
    };
    $('marswalk-start-lat').value = $('marswalk-dest-lat').value;
    $('marswalk-start-lon').value = $('marswalk-dest-lon').value;
    $('marswalk-dest-lat').value = start.latitude;
    $('marswalk-dest-lon').value = start.longitude;
    updateEndpointSummary();
    markPlanStale();
  });
  for (const input of document.querySelectorAll('input[name="marswalk-profile"]')) {
    listen(input, 'change', () => {
      if (!input.checked) return;
      applyFlightProfile(input.value);
      markPlanStale();
    });
  }
  listen($('marswalk-clearance'), 'input', () => {
    $('marswalk-clearance-value').textContent = `${formatNumber(Number($('marswalk-clearance').value))} m`;
    markCustomProfileStale();
  });
  listen($('marswalk-smoothness'), 'input', () => {
    $('marswalk-smoothness-value').textContent = Number($('marswalk-smoothness').value).toFixed(2);
    markCustomProfileStale();
  });
  listen($('marswalk-max-altitude'), 'input', markCustomProfileStale);
  ['marswalk-start-lat', 'marswalk-start-lon', 'marswalk-dest-lat', 'marswalk-dest-lon']
    .forEach(id => listen($(id), 'input', () => {
      updateEndpointSummary();
      markPlanStale();
    }));
  listen($('marswalk-play'), 'click', play);
  listen($('marswalk-speed'), 'change', () => setPlaybackSpeed($('marswalk-speed').value));
  listen($('marswalk-flight-speed'), 'change', () => setPlaybackSpeed($('marswalk-flight-speed').value));
  listen($('marswalk-flight-pause'), 'click', () => {
    if (state === 'playing') pause();
    else if (state === 'paused') play();
  });
  listen($('marswalk-flight-restart'), 'click', restart);
  listen($('marswalk-flight-stop'), 'click', stop);
  listen($('marswalk-progress'), 'input', () => {
    if (!plan || planStale) return;
    if (state === 'playing') pause();
    progress = Number($('marswalk-progress').value) / 1000;
    state = 'paused';
    updateCurrentPosition();
    updatePlaybackControls();
  });
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && active()) {
      clearSelectionMode();
      close();
    }
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden && state === 'playing') {
      pause();
      setStatus('Playback paused because the browser tab became hidden. Resume when ready.');
    }
  });
  listen(viewer.scene.canvas, 'webglcontextlost', event => {
    event.preventDefault();
    if (state === 'playing') pause();
    setStatus('Mars rendering was interrupted by a WebGL context loss. Playback has been paused; reload if the globe does not recover.', true);
  });
  listen(viewer.scene.canvas, 'webglcontextrestored', () => {
    setStatus('Mars rendering recovered. Review the route preview before resuming playback.');
  });
  const terrainInspectionHandler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  terrainInspectionHandler.setInputAction(inspectTerrainClick, C.ScreenSpaceEventType.LEFT_CLICK);
  cleanups.push(() => {
    if (!terrainInspectionHandler.isDestroyed()) terrainInspectionHandler.destroy();
  });
  listen(window, 'pagehide', event => {
    if (!event.persisted) {
      clearSelectionMode();
      stopAnimation();
      releaseCameraControl();
      requests.abortAll();
      if (flightLayoutTimer !== null) clearTimeout(flightLayoutTimer);
      document.body.classList.remove('marswalk-flight-active');
      destroyAuxiliaryViews();
      destroyPilotView();
      cleanups.forEach(cleanup => cleanup());
    }
  });
  updatePlaybackControls();
})();
