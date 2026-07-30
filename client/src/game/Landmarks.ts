// @ts-nocheck
import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom';
import { getDominantBiome } from './Biome';

// A separate, larger chunk grid from CourseDecor/Obstacles so landmark
// spacing/salt stay independent - these are rare one-off set-pieces, not
// per-chunk scenery.
const LANDMARK_CHUNK_SIZE = 240;
const SPAWN_CHANCE = 0.65;

function disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        for (const mat of obj.material) mat.dispose();
      } else {
        obj.material.dispose();
      }
    }
  });
}

function makeCabin(rng) {
  const group = new THREE.Group();
  const w = rng.range(3.2, 4.2);
  const d = rng.range(2.8, 3.6);
  const h = rng.range(2.4, 3.0);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.88 }),
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.62, 4),
    new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.7 }),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + h * 0.28;
  roof.castShadow = true;
  group.add(roof);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.9, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x554a44, roughness: 0.9 }),
  );
  chimney.position.set(w * 0.22, h + h * 0.5, -d * 0.1);
  group.add(chimney);

  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xffcf7a,
    emissive: 0xffb347,
    emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  const window1 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), windowMat);
  window1.position.set(-w * 0.22, h * 0.55, d / 2 + 0.01);
  group.add(window1);
  const window2 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), windowMat);
  window2.position.set(w * 0.22, h * 0.55, d / 2 + 0.01);
  group.add(window2);

  group.rotation.y = rng.range(-0.3, 0.3);
  return group;
}

function makeLiftPylon(rng) {
  const group = new THREE.Group();
  const height = rng.range(9, 12.5);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.55, metalness: 0.5 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, height, 7), metal);
  pole.position.y = height / 2;
  pole.castShadow = true;
  group.add(pole);

  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.09), metal);
  crossbar.position.y = height - 0.35;
  group.add(crossbar);

  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.6 });
  for (const dir of [-1, 1]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6, 4), cableMat);
    cable.position.set(dir * 0.8, height - 0.7, dir * 2.6);
    cable.rotation.x = dir * 0.62;
    group.add(cable);
  }

  group.rotation.y = rng.range(0, Math.PI * 2);
  return group;
}

function makeSnowFence(rng) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.85 });
  const slatCount = 6;
  const spacing = 0.42;

  for (let i = 0; i < slatCount; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.04), wood);
    slat.position.set((i - slatCount / 2) * spacing, 0.55, 0);
    slat.rotation.z = 0.18;
    slat.castShadow = true;
    group.add(slat);
  }

  const railTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, slatCount * spacing + 0.3, 5),
    wood,
  );
  railTop.rotation.z = Math.PI / 2;
  railTop.position.y = 0.95;
  group.add(railTop);

  group.rotation.y = rng.range(-0.2, 0.2);
  return group;
}

function makeRopeBridge(rng) {
  const group = new THREE.Group();
  const span = rng.range(9, 13);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.85 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 0.75 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 1.15), wood);
  deck.castShadow = true;
  group.add(deck);

  for (const dir of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, span, 5), rope);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.65, dir * 0.62);
    group.add(rail);
  }

  for (const dir of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), wood);
    post.position.set(dir * span * 0.5, 0.55, 0);
    group.add(post);
  }

  group.rotation.y = rng.range(0.5, 1.1) * (rng.next() > 0.5 ? 1 : -1);
  return group;
}

function makeRuin(rng) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.92 });

  const wallCount = 2 + Math.round(rng.range(0, 1));
  for (let i = 0; i < wallCount; i++) {
    const w = rng.range(1.2, 2.2);
    const h = rng.range(0.9, 2.1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.35), stone);
    wall.position.set(rng.range(-1.6, 1.6), h / 2, rng.range(-1.2, 1.2));
    wall.rotation.y = rng.range(0, Math.PI);
    wall.rotation.z = rng.range(-0.08, 0.08);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 2.4, 8), stone);
  pillar.rotation.z = Math.PI / 2;
  pillar.rotation.y = rng.range(0, Math.PI);
  pillar.position.set(rng.range(-1.4, 1.4), 0.24, rng.range(-1.4, 1.4));
  pillar.castShadow = true;
  group.add(pillar);

  return group;
}

const BIOME_FACTORIES = {
  forest: [makeCabin, makeLiftPylon],
  alpine: [makeLiftPylon, makeSnowFence],
  cliffs: [makeRopeBridge, makeRuin],
};

export class Landmarks {
  constructor(scene, seed = 1, quality = 'high') {
    this.scene = scene;
    this.seed = seed;
    this.quality = quality;
    this.chunks = new Map();
    this.active = [];
  }

  generateChunk(chunkIndex) {
    if (this.chunks.has(chunkIndex)) return;

    const rng = new SeededRandom(this.seed + chunkIndex * 5231 + 4021);
    const zBase = chunkIndex * LANDMARK_CHUNK_SIZE;
    const group = new THREE.Group();
    const items = [];

    if (rng.next() < SPAWN_CHANCE) {
      const biome = getDominantBiome(zBase + LANDMARK_CHUNK_SIZE / 2);
      const pool = BIOME_FACTORIES[biome] || BIOME_FACTORIES.forest;
      const factory = pool[Math.floor(rng.next() * pool.length) % pool.length];

      const mesh = factory(rng);
      const side = rng.next() > 0.5 ? 1 : -1;
      // Past the CourseDecor border treeline (58-108) so landmarks read as
      // glimpsed beyond the trees rather than buried inside them.
      const x = side * rng.range(88, 112);
      const z = zBase + rng.range(20, LANDMARK_CHUNK_SIZE - 20);

      mesh.position.set(x, 0, z);
      mesh.userData.x = x;
      mesh.userData.z = z;
      group.add(mesh);
      items.push(mesh);
      this.active.push(mesh);
    }

    this.scene.add(group);
    this.chunks.set(chunkIndex, { group, items });
  }

  update(dt, playerZ, groundYAt = null) {
    const currentChunk = Math.floor(playerZ / LANDMARK_CHUNK_SIZE);

    for (let i = currentChunk; i <= currentChunk + 2; i++) {
      this.generateChunk(i);
    }

    for (const mesh of this.active) {
      const groundY = groundYAt ? groundYAt(mesh.userData.x, mesh.userData.z) : 0;
      mesh.position.y = groundY;
    }

    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx < currentChunk - 1) {
        this.scene.remove(chunk.group);
        disposeGroup(chunk.group);
        for (const item of chunk.items) {
          const activeIdx = this.active.indexOf(item);
          if (activeIdx !== -1) this.active.splice(activeIdx, 1);
        }
        this.chunks.delete(idx);
      }
    }
  }

  dispose() {
    for (const [, chunk] of this.chunks) {
      this.scene.remove(chunk.group);
      disposeGroup(chunk.group);
    }
    this.chunks.clear();
    this.active.length = 0;
  }
}
