// @ts-nocheck
import * as THREE from 'three';

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    // Offset from player in local space
    this._offset = new THREE.Vector3(0, 7, -10);
    this._lookAheadDist = 5;
    this._smoothPos = null;
    this._smoothLook = null;
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
    this.camera.lookAt(this._smoothLook);
  }

  reset() {
    this._smoothPos = null;
    this._smoothLook = null;
  }
}
