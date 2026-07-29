// @ts-nocheck
import * as THREE from 'three';

const FOV_MAX_SPEED = 28; // matches BOOST_SPEED in Player.ts / shared sim
const FOV_WIDEN_DEGREES = 7;
const FOV_SMOOTHING_RATE = 3;

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
  }

  /** Short decaying positional shake — landings, collisions, boost kick. */
  shake(intensity = 0.3, duration = 0.25) {
    this._shakeTime = duration;
    this._shakeDuration = duration;
    this._shakeIntensity = intensity;
  }

  update(dt, playerMesh, playerSpeed) {
    if (!playerMesh) return;

    const target = playerMesh.position.clone();

    // Compute desired camera position: offset in world space (always behind player)
    const angle = playerMesh.rotation.y;
    const sinA = Math.sin(-angle);
    const cosA = Math.cos(-angle);

    const desiredPos = new THREE.Vector3(
      target.x + sinA * this._offset.z,
      target.y + this._offset.y,
      target.z + cosA * this._offset.z,
    );

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

    this.camera.lookAt(this._smoothLook);

    // Widen slightly at speed for a sense of velocity, same trick as a
    // dolly zoom - purely cosmetic, no effect on gameplay framing logic.
    const speed01 = THREE.MathUtils.clamp((playerSpeed || 0) / FOV_MAX_SPEED, 0, 1);
    const targetFov = this._baseFov + speed01 * FOV_WIDEN_DEGREES;
    this._fov = THREE.MathUtils.lerp(this._fov, targetFov, Math.min(1, FOV_SMOOTHING_RATE * dt));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
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
