// @ts-nocheck
import * as THREE from 'three';
import { buildSkierMesh, setSkierNameLabel, updateSkierAnimation } from './SkierModel';
import { DEFAULT_PLAYER_COLOR, sanitizePlayerColor } from '../../../shared/AuthoritativeSim';

const INTERPOLATION_DELAY_MS = 100;
const MAX_SNAPSHOT_HISTORY = 12;
const MAX_EXTRAPOLATION_MS = 140;
const CLOCK_OFFSET_SMOOTHING = 0.15;
const VISUAL_SMOOTHING_RATE = 18;
const VISUAL_SNAP_DISTANCE = 6;

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
    this._clockOffsetMs = null;
    this._visualPosition = null;
    this._visualAngle = 0;
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

  receiveState(state, serverTick, simTimeMs, receivedAtMs = performance.now()) {
    const tick = Number(serverTick);
    if (Number.isFinite(tick) && tick <= this._lastServerTick) return false;

    if (Number.isFinite(tick)) this._lastServerTick = tick;

    // Snapshots key their position on the buffer by the authoritative sim
    // clock, not arrival time: the server tick loop can emit two snapshots
    // back-to-back to catch up on drift, which would otherwise collapse the
    // interpolation span between them to ~0ms and read as a snap.
    const resolvedSimTimeMs = Number.isFinite(simTimeMs) ? simTimeMs : receivedAtMs;
    const offsetSample = resolvedSimTimeMs - receivedAtMs;
    this._clockOffsetMs = this._clockOffsetMs === null
      ? offsetSample
      : this._clockOffsetMs + (offsetSample - this._clockOffsetMs) * CLOCK_OFFSET_SMOOTHING;

    this._snapshots.push({
      state: { ...state },
      serverTick: Number.isFinite(tick) ? tick : this._lastServerTick + 1,
      simTimeMs: resolvedSimTimeMs,
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

  _sampleState(renderSimTimeMs) {
    const snapshots = this._snapshots;
    if (snapshots.length === 1 || renderSimTimeMs <= snapshots[0].simTimeMs) {
      return snapshots[0].state;
    }

    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1];
      const next = snapshots[i];
      if (renderSimTimeMs > next.simTimeMs) continue;

      const span = Math.max(1, next.simTimeMs - previous.simTimeMs);
      const t = THREE.MathUtils.clamp((renderSimTimeMs - previous.simTimeMs) / span, 0, 1);
      return this._interpolate(previous.state, next.state, t);
    }

    const last = snapshots[snapshots.length - 1];
    const latest = last.state;
    const extraSeconds = THREE.MathUtils.clamp(
      (renderSimTimeMs - last.simTimeMs) / 1000,
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

    const renderSimTimeMs = nowMs + (this._clockOffsetMs || 0) - INTERPOLATION_DELAY_MS;
    const state = this._sampleState(renderSimTimeMs);
    const x = state.x;
    const z = state.z;
    const airborneY = Math.max(0, state.y || 0);
    const groundY = groundYAt ? groundYAt(x, z) : 0;
    const alive = state.alive !== false;
    const targetY = Math.max(groundY + airborneY, groundY + 0.035);
    const targetAngle = state.angle || 0;

    // The sampled snapshot state above is the logical/authoritative target.
    // What actually gets drawn eases toward it instead of snapping straight
    // there, so any residual micro-jitter in the sampled value (clock-offset
    // drift, the interpolate/extrapolate seam) doesn't show up 1:1 on screen
    // — mirroring the decaying visual correction already used for the local
    // player in Game.ts.
    if (!this._visualPosition) {
      this._visualPosition = new THREE.Vector3(x, targetY, z);
      this._visualAngle = targetAngle;
    } else if (Math.hypot(x - this._visualPosition.x, z - this._visualPosition.z) > VISUAL_SNAP_DISTANCE) {
      this._visualPosition.set(x, targetY, z);
      this._visualAngle = targetAngle;
    } else {
      const blend = 1 - Math.exp(-VISUAL_SMOOTHING_RATE * dt);
      this._visualPosition.x += (x - this._visualPosition.x) * blend;
      this._visualPosition.y += (targetY - this._visualPosition.y) * blend;
      this._visualPosition.z += (z - this._visualPosition.z) * blend;
      const angleDelta = Math.atan2(Math.sin(targetAngle - this._visualAngle), Math.cos(targetAngle - this._visualAngle));
      this._visualAngle += angleDelta * blend;
    }

    this.mesh.position.copy(this._visualPosition);
    const angle = this._visualAngle;
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
