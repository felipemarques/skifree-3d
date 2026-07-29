// @ts-nocheck
import * as THREE from 'three';
import { buildSkierMesh, updateSkierAnimation } from './SkierModel';

const GHOST_OPACITY = 0.42;
const GHOST_FADE_SECONDS = 1.2;

export class GhostPlayer {
  constructor(scene, keyframes, options = {}) {
    this.scene = scene;
    this.keyframes = Array.isArray(keyframes) ? keyframes : [];
    this.mesh = buildSkierMesh(options.color ?? 0x9fd8ff, {
      helmetColor: options.color ?? 0x9fd8ff,
      scarfColor: 0xffffff,
      scale: 0.92,
      name: 'Ghost',
    });
    this._setOpacity(GHOST_OPACITY);
    scene.add(this.mesh);

    this._finished = false;
    this._fadeT = 1;
  }

  _setOpacity(opacity) {
    this.mesh.traverse(obj => {
      if (obj.material) {
        obj.material.transparent = true;
        obj.material.opacity = opacity;
      }
    });
  }

  _sample(elapsedMs) {
    const frames = this.keyframes;
    if (!frames.length) return null;
    if (elapsedMs <= frames[0].t) return frames[0];
    const last = frames[frames.length - 1];
    if (elapsedMs >= last.t) return null;

    for (let i = 1; i < frames.length; i++) {
      const next = frames[i];
      if (elapsedMs > next.t) continue;
      const previous = frames[i - 1];
      const span = Math.max(1, next.t - previous.t);
      const t = THREE.MathUtils.clamp((elapsedMs - previous.t) / span, 0, 1);
      const angleDelta = Math.atan2(
        Math.sin(next.angle - previous.angle),
        Math.cos(next.angle - previous.angle),
      );
      return {
        x: THREE.MathUtils.lerp(previous.x, next.x, t),
        y: THREE.MathUtils.lerp(previous.y, next.y, t),
        z: THREE.MathUtils.lerp(previous.z, next.z, t),
        angle: previous.angle + angleDelta * t,
        speed: THREE.MathUtils.lerp(previous.speed, next.speed, t),
        airborne: t < 1 ? previous.airborne : next.airborne,
      };
    }
    return last;
  }

  update(dt, elapsedMs, groundYAt = null) {
    if (this._finished) {
      if (this._fadeT > 0) {
        this._fadeT = Math.max(0, this._fadeT - dt / GHOST_FADE_SECONDS);
        this._setOpacity(GHOST_OPACITY * this._fadeT);
        if (this._fadeT === 0) this.mesh.visible = false;
      }
      return;
    }

    const state = this._sample(elapsedMs);
    if (!state) {
      this._finished = true;
      updateSkierAnimation(this.mesh, { dt, speed: 0, steer: 0, airborne: false, airTime: 0 });
      return;
    }

    const groundY = groundYAt ? groundYAt(state.x, state.z) : 0;
    const y = Math.max(groundY + Math.max(0, state.y), groundY + 0.035);

    this.mesh.position.set(state.x, y, state.z);
    this.mesh.rotation.set(0, -state.angle, 0);

    updateSkierAnimation(this.mesh, {
      dt,
      speed: state.speed,
      steer: THREE.MathUtils.clamp(state.angle / (Math.PI * 0.42), -1, 1),
      airborne: state.airborne,
      airTime: state.airborne ? elapsedMs / 1000 : 0,
    });
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material?.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}
