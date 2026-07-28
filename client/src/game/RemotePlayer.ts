// @ts-nocheck
import * as THREE from 'three';
import { buildSkierMesh, setSkierNameLabel, updateSkierAnimation } from './SkierModel';
import { DEFAULT_PLAYER_COLOR, sanitizePlayerColor } from '../../../shared/AuthoritativeSim';

const INTERPOLATION_DELAY_MS = 0;
const MAX_SNAPSHOT_HISTORY = 12;
const MAX_EXTRAPOLATION_MS = 140;

function colorToNumber(color) {
  return parseInt(sanitizePlayerColor(color).slice(1), 16);
}

export class RemotePlayer {
  constructor(scene, id, name, color = DEFAULT_PLAYER_COLOR) {
    this.id = id;
    this.name = name;
    this.color = sanitizePlayerColor(color);
    this.scene = scene;
    this.mesh = this._buildMesh();
    scene.add(this.mesh);

    this._snapshots = [];
    this._lastServerTick = -1;
    this.currentSpeed = 0;
  }

  _buildMesh() {
    const color = colorToNumber(this.color);
    return buildSkierMesh(color, {
      helmetColor: color,
      scarfColor: 0xffd54f,
      scale: 0.92,
      name: this.name,
    });
  }

  setColor(color) {
    const nextColor = sanitizePlayerColor(color);
    if (nextColor === this.color) return;
    const position = this.mesh.position.clone();
    const rotation = this.mesh.rotation.clone();
    this.scene.remove(this.mesh);
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material?.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.color = nextColor;
    this.mesh = this._buildMesh();
    this.mesh.position.copy(position);
    this.mesh.rotation.copy(rotation);
    this.scene.add(this.mesh);
  }

  receiveState(state, serverTick, receivedAtMs = performance.now()) {
    const tick = Number(serverTick);
    if (Number.isFinite(tick) && tick <= this._lastServerTick) return false;

    if (Number.isFinite(tick)) this._lastServerTick = tick;
    this._snapshots.push({
      state: { ...state },
      serverTick: Number.isFinite(tick) ? tick : this._lastServerTick + 1,
      receivedAtMs,
    });
    if (this._snapshots.length > MAX_SNAPSHOT_HISTORY) this._snapshots.shift();
    return true;
  }

  getLatestState() {
    return this._snapshots[this._snapshots.length - 1]?.state || null;
  }

  setName(name) {
    const nextName = String(name || 'Player').slice(0, 16);
    if (nextName === this.name) return;
    this.name = nextName;
    setSkierNameLabel(this.mesh, this.name);
  }

  _sampleState(renderAtMs) {
    const snapshots = this._snapshots;
    if (snapshots.length === 1 || renderAtMs <= snapshots[0].receivedAtMs) {
      return snapshots[0].state;
    }

    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1];
      const next = snapshots[i];
      if (renderAtMs > next.receivedAtMs) continue;

      const span = Math.max(1, next.receivedAtMs - previous.receivedAtMs);
      const t = THREE.MathUtils.clamp((renderAtMs - previous.receivedAtMs) / span, 0, 1);
      return this._interpolate(previous.state, next.state, t);
    }

    const latest = snapshots[snapshots.length - 1].state;
    const extraSeconds = THREE.MathUtils.clamp(
      (renderAtMs - snapshots[snapshots.length - 1].receivedAtMs) / 1000,
      0,
      MAX_EXTRAPOLATION_MS / 1000,
    );
    if (!extraSeconds || latest.alive === false || latest.y > 0.05) return latest;
    return {
      ...latest,
      x: latest.x + Math.sin(latest.angle || 0) * (latest.speed || 0) * extraSeconds,
      z: latest.z + Math.cos(latest.angle || 0) * (latest.speed || 0) * extraSeconds,
    };
  }

  _interpolate(previous, next, t) {
    const angleDelta = Math.atan2(
      Math.sin((next.angle || 0) - (previous.angle || 0)),
      Math.cos((next.angle || 0) - (previous.angle || 0)),
    );
    return {
      ...next,
      x: THREE.MathUtils.lerp(previous.x, next.x, t),
      y: THREE.MathUtils.lerp(previous.y || 0, next.y || 0, t),
      z: THREE.MathUtils.lerp(previous.z, next.z, t),
      angle: (previous.angle || 0) + angleDelta * t,
      speed: THREE.MathUtils.lerp(previous.speed || 0, next.speed || 0, t),
      alive: t < 1 ? previous.alive !== false : next.alive !== false,
    };
  }

  update(dt, groundYAt = null, nowMs = performance.now()) {
    if (!this._snapshots.length) return;

    const state = this._sampleState(nowMs - INTERPOLATION_DELAY_MS);
    const x = state.x;
    const z = state.z;
    const airborneY = Math.max(0, state.y || 0);
    const groundY = groundYAt ? groundYAt(x, z) : 0;
    const alive = state.alive !== false;

    this.mesh.position.set(x, Math.max(groundY + airborneY, groundY + 0.035), z);
    const angle = state.angle || 0;
    const speed = alive ? state.speed || 0 : 0;
    this.currentSpeed = speed;
    this.mesh.rotation.y = -angle;
    if (!alive) {
      this.mesh.rotation.x = -Math.PI * 0.5;
      this.mesh.rotation.z = Math.sin((this.id.length || 1) * 1.7) * 0.55;
      return;
    }
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;

    updateSkierAnimation(this.mesh, {
      dt,
      speed,
      steer: THREE.MathUtils.clamp(angle / (Math.PI * 0.42), -1, 1),
      airborne: airborneY > 0.05,
      airTime: airborneY > 0.05 ? nowMs / 1000 : 0,
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
