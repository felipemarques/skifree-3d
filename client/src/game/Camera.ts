// @ts-nocheck
import * as THREE from 'three';

const FOV_MAX_SPEED = 28; // matches BOOST_SPEED in Player.ts / shared sim
export const FOV_WIDEN_DEGREES = 7;
const FOV_SMOOTHING_RATE = 3;
// Obstacle/terrain avoidance (M12): the camera rides a fixed offset
// (0, 7, -10) behind the skier, which clips through trees and dips under
// visual-terrain relief on high graphics. Each frame the desired position is
// (a) clamped above the ground height at its own x/z and (b) pulled in along
// the head→camera ray to just before the nearest tall obstacle the ray
// crosses. Pure math on the existing AABB records - no per-frame mesh
// raycasts.
const CAMERA_HEAD_HEIGHT = 1.5; // ray origin above the player mesh origin
const CAMERA_FLOOR_CLEARANCE = 0.6;
const CAMERA_OBSTACLE_CLEARANCE = 1.1; // footprint inflation
const CAMERA_OBSTACLE_BACK = 1.3; // stop this far before the obstacle face
// Nominal heights of the tall obstacle types the line of sight can cross.
// Short stuff (rocks, ramps, hearts, fallen trunks, holes) the camera rides
// above naturally and must not trigger pull-ins.
const CAMERA_OCCLUDER_HEIGHTS = { tree: 7, stump: 2.4 };

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    // Offset from player in local space
    this._offset = new THREE.Vector3(0, 7, -10);
    this._lookAheadDist = 5;
    this._smoothPos = null;
    this._smoothLook = null;
    this._shakeTime = 0;
    this._shakeDuration = 0;
    this._shakeIntensity = 0;
    this._baseFov = camera.fov;
    this._fov = camera.fov;
    this._speed01 = 0;
  }

  /** Short decaying positional shake — landings, collisions, boost kick. */
  shake(intensity = 0.3, duration = 0.25) {
    this._shakeTime = duration;
    this._shakeDuration = duration;
    this._shakeIntensity = intensity;
  }

  update(dt, playerMesh, playerSpeed, env = null) {
    if (!playerMesh) return;

    const target = playerMesh.position.clone();

    // Compute desired camera position: offset in world space (always behind player)
    // Uses the ground heading, not the raw mesh yaw - the mesh yaw includes
    // any in-air trick spin (Player.ts), and if the camera orbited along
    // with that too it would cancel the spin out on screen (chase cam
    // silently staying "behind" a spinning character reads as no spin at
    // all). userData.headingAngle is the pre-trick heading; mesh.rotation.y
    // itself is only used as a fallback for meshes that never set it.
    const angle = playerMesh.userData?.headingAngle ?? playerMesh.rotation.y;
    const sinA = Math.sin(-angle);
    const cosA = Math.cos(-angle);

    const desiredPos = new THREE.Vector3(
      target.x + sinA * this._offset.z,
      target.y + this._offset.y,
      target.z + cosA * this._offset.z,
    );

    // M12: pull the desired position in front of any tall obstacle the
    // head→camera ray crosses, and never let it sink below the ground.
    // Both apply to the desired position; the smooth follow blends them in.
    if (env?.occluders) {
      const pulled = this._pullBehindOccluders(target, desiredPos, env.occluders());
      if (pulled) desiredPos.copy(pulled);
    }
    if (env?.groundHeightAt) {
      const floor = env.groundHeightAt(desiredPos.x, desiredPos.z) + CAMERA_FLOOR_CLEARANCE;
      if (desiredPos.y < floor) desiredPos.y = floor;
    }

    // Smooth follow
    if (!this._smoothPos) {
      this._smoothPos = desiredPos.clone();
      this._smoothLook = target.clone();
    }

    const smoothFactor = Math.min(1, 5 * dt);
    this._smoothPos.lerp(desiredPos, smoothFactor);
    this._smoothLook.lerp(
      new THREE.Vector3(target.x, target.y + 0.8, target.z + this._lookAheadDist),
      smoothFactor
    );

    this.camera.position.copy(this._smoothPos);

    if (this._shakeTime > 0) {
      this._shakeTime = Math.max(0, this._shakeTime - dt);
      const falloff = this._shakeDuration > 0 ? this._shakeTime / this._shakeDuration : 0;
      const magnitude = this._shakeIntensity * falloff * falloff;
      this.camera.position.x += (Math.random() - 0.5) * 2 * magnitude;
      this.camera.position.y += (Math.random() - 0.5) * 2 * magnitude;
    }

    // Clamp the smoothed position above the ground too: the lerp lags a
    // quickly rising relief for a few frames and would otherwise dip the
    // camera through it.
    if (env?.groundHeightAt) {
      const floor = env.groundHeightAt(this.camera.position.x, this.camera.position.z) + CAMERA_FLOOR_CLEARANCE;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
    }

    this.camera.lookAt(this._smoothLook);

    // Widen slightly at speed for a sense of velocity, same trick as a
    // dolly zoom - purely cosmetic, no effect on gameplay framing logic.
    const speed01 = THREE.MathUtils.clamp((playerSpeed || 0) / FOV_MAX_SPEED, 0, 1);
    this._speed01 = speed01;
    const targetFov = this._baseFov + speed01 * FOV_WIDEN_DEGREES;
    this._fov = THREE.MathUtils.lerp(this._fov, targetFov, Math.min(1, FOV_SMOOTHING_RATE * dt));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slab test along one axis; mutates bounds.tMin/tMax. False = ray misses. */
  _slabAxis(origin, dir, min, max, bounds) {
    if (Math.abs(dir) < 1e-8) return origin >= min && origin <= max;
    let t0 = (min - origin) / dir;
    let t1 = (max - origin) / dir;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    bounds.tMin = Math.max(bounds.tMin, t0);
    bounds.tMax = Math.min(bounds.tMax, t1);
    return bounds.tMin <= bounds.tMax;
  }

  /**
   * If the ray from the skier's head to the desired camera position crosses
   * a tall obstacle (tree/stump) footprint, returns a camera position pulled
   * in along the ray to just before the nearest crossing; null if clear.
   */
  _pullBehindOccluders(from, to, records) {
    const origin = new THREE.Vector3(from.x, from.y + CAMERA_HEAD_HEIGHT, from.z);
    const segDir = new THREE.Vector3().subVectors(to, origin);
    const segLen = segDir.length();
    if (segLen < 0.001) return null;
    segDir.divideScalar(segLen);

    let nearestT = 1;
    for (const obs of records || []) {
      const height = CAMERA_OCCLUDER_HEIGHTS[obs.type];
      if (!height) continue;
      const bounds = { tMin: 0, tMax: 1 };
      const hw = obs.halfW + CAMERA_OBSTACLE_CLEARANCE;
      const hd = obs.halfD + CAMERA_OBSTACLE_CLEARANCE;
      if (!this._slabAxis(origin.x, segDir.x, obs.x - hw, obs.x + hw, bounds)) continue;
      if (!this._slabAxis(origin.z, segDir.z, obs.z - hd, obs.z + hd, bounds)) continue;
      if (bounds.tMax < 0 || bounds.tMin > 1) continue; // behind or past the camera
      const tEnter = Math.max(0, bounds.tMin);
      if (origin.y + segDir.y * (tEnter * segLen) >= height) continue; // line rides over it
      const t = Math.max(0, tEnter - CAMERA_OBSTACLE_BACK / segLen);
      if (t < nearestT) nearestT = t;
    }
    if (nearestT >= 1) return null;
    return origin.clone().addScaledVector(segDir, segLen * nearestT);
  }

  reset() {
    this._smoothPos = null;
    this._smoothLook = null;
    this._shakeTime = 0;
    this._fov = this._baseFov;
    this.camera.fov = this._baseFov;
    this.camera.updateProjectionMatrix();
  }
}
