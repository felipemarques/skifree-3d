// @ts-nocheck
import * as THREE from 'three';

// Mirrors shared/AuthoritativeSim.ts's TRACK_LIMIT/FORK_LANE_GAP - confines
// the wind streaks to the same safe-lane band the SnowTerrain ice stripe
// paints, so the two visuals read as one coherent "icy/windy" cue.
const LANE_MIN_X = -50;
const LANE_MAX_X = -7;
const SPAWN_HALF_RANGE_Z = 60;
const STREAK_COUNT = 60;
const STREAK_LENGTH = 2.4;
const BASE_SPEED = 16;
const FADE_RATE = 4;

function spawnStreak(state) {
  state.x = LANE_MIN_X + Math.random() * (LANE_MAX_X - LANE_MIN_X);
  state.y = 0.12 + Math.random() * 1.7;
  state.z = SPAWN_HALF_RANGE_Z * (0.4 + Math.random() * 0.6);
  state.speed = BASE_SPEED * (0.7 + Math.random() * 0.7);
  state.windAngle = -(Math.random() - 0.5) * 0.7;
}

/** Wind-streak particles confined to a fork zone's safe lane - reinforces
 * the icy stripe (SnowTerrain.ts) as a single "windy/icy" visual language
 * rather than adding an unrelated third cue. Cross-fades in/out via
 * setActive so it only costs anything while a fork zone is actually near. */
export class ForkWindEffect {
  constructor(scene) {
    this.scene = scene;
    this._active = false;
    this._states = Array.from({ length: STREAK_COUNT }, () => {
      const s = {};
      spawnStreak(s);
      s.z = (Math.random() - 0.5) * SPAWN_HALF_RANGE_Z * 2;
      return s;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAK_COUNT * 2 * 3), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbfe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  setActive(active) {
    this._active = !!active;
  }

  update(dt, cameraPos) {
    const targetOpacity = this._active ? 0.4 : 0;
    const mat = this.lines.material;
    mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, dt * FADE_RATE);

    this.lines.position.copy(cameraPos);
    this.lines.position.y = 0;

    if (mat.opacity < 0.01 && !this._active) return; // skip simulation while invisible

    const pos = this.lines.geometry.attributes.position.array;
    const now = performance.now();
    for (let i = 0; i < STREAK_COUNT; i++) {
      const p = this._states[i];
      p.z -= p.speed * dt;
      p.x += Math.sin(p.windAngle + now * 0.0006 + i) * dt * 3;
      p.x = THREE.MathUtils.clamp(p.x, LANE_MIN_X, LANE_MAX_X);
      if (p.z < -SPAWN_HALF_RANGE_Z) spawnStreak(p);

      const dirX = Math.sin(p.windAngle) * STREAK_LENGTH * 0.5;
      const dirZ = -Math.cos(p.windAngle) * STREAK_LENGTH * 0.5;
      const i6 = i * 6;
      pos[i6] = p.x - dirX;
      pos[i6 + 1] = p.y;
      pos[i6 + 2] = p.z - dirZ;
      pos[i6 + 3] = p.x + dirX;
      pos[i6 + 4] = p.y;
      pos[i6 + 5] = p.z + dirZ;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
