import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeLayer(scene, config) {
  const count = Math.max(0, Math.round(config.count));
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const drift = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * config.rangeX;
    positions[i * 3 + 1] = Math.random() * config.height;
    positions[i * 3 + 2] = (Math.random() - 0.5) * config.rangeZ;
    speeds[i] = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
    drift[i] = (Math.random() - 0.5) * config.drift;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: config.size,
    transparent: true,
    opacity: config.opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return {
    ...config,
    count,
    positions,
    speeds,
    drift,
    points,
  };
}

export class SnowParticles {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.quality = options.quality || 'high';
    this.volume = clamp(Number(options.volume ?? 1), 0, 2);
    this._windPhase = Math.random() * Math.PI * 2;
    this.layers = [];

    if (this.quality === 'high') {
      this.layers.push(makeLayer(scene, {
        count: 1180 * this.volume,
        rangeX: 145,
        rangeZ: 150,
        height: 24,
        minSpeed: 1.0,
        maxSpeed: 3.3,
        drift: 0.95,
        size: 0.105,
        opacity: 0.31,
        forwardPush: 1.2,
      }));
      this.layers.push(makeLayer(scene, {
        count: 240 * this.volume,
        rangeX: 95,
        rangeZ: 105,
        height: 18,
        minSpeed: 1.9,
        maxSpeed: 4.4,
        drift: 1.35,
        size: 0.24,
        opacity: 0.22,
        forwardPush: 1.6,
      }));
    } else {
      this.layers.push(makeLayer(scene, {
        count: 340 * this.volume,
        rangeX: 120,
        rangeZ: 120,
        height: 18,
        minSpeed: 1.0,
        maxSpeed: 2.8,
        drift: 0.72,
        size: 0.105,
        opacity: 0.25,
        forwardPush: 1.0,
      }));
      this.layers.push(makeLayer(scene, {
        count: 70 * this.volume,
        rangeX: 80,
        rangeZ: 90,
        height: 14,
        minSpeed: 1.6,
        maxSpeed: 3.4,
        drift: 1.0,
        size: 0.2,
        opacity: 0.18,
        forwardPush: 1.2,
      }));
    }
  }

  update(dt, cameraPos, playerSpeed = 0) {
    const wind = Math.sin(performance.now() * 0.00045 + this._windPhase) * 0.65;
    const speedPush = Math.min(playerSpeed / 28, 1) * 0.85;

    for (const layer of this.layers) {
      const pos = layer.positions;
      for (let i = 0; i < layer.count; i++) {
        pos[i * 3 + 1] -= layer.speeds[i] * dt * 1.5;
        pos[i * 3] += (wind + layer.drift[i]) * dt;
        pos[i * 3 + 2] -= speedPush * layer.forwardPush * dt * (1.3 + layer.speeds[i] * 0.18);

        if (
          pos[i * 3 + 1] < -1 ||
          Math.abs(pos[i * 3]) > layer.rangeX * 0.56 ||
          Math.abs(pos[i * 3 + 2]) > layer.rangeZ * 0.56
        ) {
          pos[i * 3] = (Math.random() - 0.5) * layer.rangeX;
          pos[i * 3 + 1] = layer.height * 0.72 + Math.random() * layer.height * 0.36;
          pos[i * 3 + 2] = (Math.random() - 0.5) * layer.rangeZ;
        }
      }

      layer.points.geometry.attributes.position.needsUpdate = true;
      layer.points.position.copy(cameraPos);
      layer.points.position.y = 0;
    }
  }

  dispose() {
    for (const layer of this.layers) {
      this.scene.remove(layer.points);
      layer.points.geometry.dispose();
      layer.points.material.dispose();
    }
    this.layers.length = 0;
  }
}
