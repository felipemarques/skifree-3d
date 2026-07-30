// @ts-nocheck
import * as THREE from 'three';

const GRAVITY = 14;

/**
 * Lightweight pooled point-particle bursts shared by ski spray and impact
 * debris. Particles don't fade (PointsMaterial has no per-vertex alpha
 * without a custom shader) - they just vanish once their lifetime or the
 * ground plane is reached, which reads fine for brief, small dust puffs.
 */
export class ImpactParticles {
  constructor(scene, maxParticles = 220) {
    this.scene = scene;
    this.maxParticles = maxParticles;

    this._positions = new Float32Array(maxParticles * 3);
    this._colors = new Float32Array(maxParticles * 3);
    this._velocities = new Float32Array(maxParticles * 3);
    this._life = new Float32Array(maxParticles);
    this._groundY = new Float32Array(maxParticles);
    this._gravityScale = new Float32Array(maxParticles);

    for (let i = 0; i < maxParticles; i++) {
      this._positions[i * 3 + 1] = -9999;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.26,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this._cursor = 0;
  }

  burst(x, y, z, options = {}) {
    const count = Math.min(options.count ?? 10, this.maxParticles);
    const color = options.color ?? [0.95, 0.97, 1];
    const speed = options.speed ?? 2.2;
    const spread = options.spread ?? 1;
    const upBias = options.upBias ?? 1.6;
    const life = options.life ?? 0.4;
    const groundY = options.groundY ?? 0;
    const gravityScale = options.gravityScale ?? 1;
    const drift = options.drift ?? null;

    for (let n = 0; n < count; n++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % this.maxParticles;

      const angle = Math.random() * Math.PI * 2;
      const radial = Math.random() * speed * spread;
      this._velocities[i * 3] = Math.cos(angle) * radial + (drift ? drift.x || 0 : 0);
      this._velocities[i * 3 + 1] = Math.random() * speed * upBias + (drift ? drift.y || 0 : 0);
      this._velocities[i * 3 + 2] = Math.sin(angle) * radial + (drift ? drift.z || 0 : 0);

      this._positions[i * 3] = x;
      this._positions[i * 3 + 1] = y;
      this._positions[i * 3 + 2] = z;

      this._colors[i * 3] = color[0];
      this._colors[i * 3 + 1] = color[1];
      this._colors[i * 3 + 2] = color[2];

      this._life[i] = life * (0.7 + Math.random() * 0.6);
      this._groundY[i] = groundY;
      this._gravityScale[i] = gravityScale;
    }

    this.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let anyAlive = false;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this._life[i] <= 0) continue;
      anyAlive = true;
      this._life[i] -= dt;

      const vy = this._velocities[i * 3 + 1] - GRAVITY * this._gravityScale[i] * dt;
      this._velocities[i * 3 + 1] = vy;
      this._positions[i * 3] += this._velocities[i * 3] * dt;
      this._positions[i * 3 + 1] += vy * dt;
      this._positions[i * 3 + 2] += this._velocities[i * 3 + 2] * dt;

      if (this._life[i] <= 0 || this._positions[i * 3 + 1] <= this._groundY[i]) {
        this._life[i] = 0;
        this._positions[i * 3 + 1] = -9999;
      }
    }
    if (anyAlive) this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
