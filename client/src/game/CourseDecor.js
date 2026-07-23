import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom.js';

const CHUNK_SIZE = 80;
const TRACK_EDGE = 54;

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

function makeFlag(color, side, rng) {
  const group = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6),
    new THREE.MeshStandardMaterial({ color: 0xd7e6f2, roughness: 0.48, metalness: 0.18 }),
  );
  pole.position.y = 0.58;
  pole.castShadow = true;
  group.add(pole);

  const flagGeo = new THREE.BufferGeometry();
  const dir = side < 0 ? 1 : -1;
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 1.05, 0,
    dir * rng.range(0.42, 0.58), 0.92, 0,
    0, 0.78, 0,
  ], 3));
  flagGeo.setIndex([0, 1, 2]);
  flagGeo.computeVertexNormals();

  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      side: THREE.DoubleSide,
    }),
  );
  flag.userData.wave = true;
  group.add(flag);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.14, 0.05, 8),
    new THREE.MeshStandardMaterial({ color: 0xddecf7, roughness: 0.8 }),
  );
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  group.rotation.y = side < 0 ? 0.2 : -0.2;
  return group;
}

function makeGate(rng) {
  const group = new THREE.Group();
  const width = rng.range(5.2, 7.4);
  const colorA = rng.next() > 0.5 ? 0x2d7fff : 0xff5d64;
  const colorB = colorA === 0x2d7fff ? 0xff5d64 : 0x2d7fff;

  for (let side = -1; side <= 1; side += 2) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.35, 6),
      new THREE.MeshStandardMaterial({ color: 0xe4f2fb, roughness: 0.5, metalness: 0.16 }),
    );
    post.position.set(side * width * 0.5, 0.68, 0);
    post.castShadow = true;
    group.add(post);

    const pennant = makeFlag(side < 0 ? colorA : colorB, -side, rng);
    pennant.position.set(side * width * 0.5, 0.18, 0);
    pennant.scale.setScalar(0.7);
    group.add(pennant);
  }

  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, width, 5),
    new THREE.MeshStandardMaterial({ color: 0xb9d4e7, roughness: 0.55, metalness: 0.08 }),
  );
  rope.position.y = 1.28;
  rope.rotation.z = Math.PI * 0.5;
  group.add(rope);

  group.rotation.y = rng.range(-0.08, 0.08);
  return group;
}

function makeSnowStake(rng) {
  const group = new THREE.Group();
  const stake = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.7, 0.07),
    new THREE.MeshStandardMaterial({
      color: rng.next() > 0.5 ? 0xff5d64 : 0x2d7fff,
      roughness: 0.58,
    }),
  );
  stake.position.y = 0.36;
  stake.castShadow = true;
  group.add(stake);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0xf2f8fc, roughness: 0.7 }),
  );
  cap.position.y = 0.75;
  group.add(cap);
  return group;
}

export class CourseDecor {
  constructor(scene, seed = 1, quality = 'high') {
    this.scene = scene;
    this.seed = seed;
    this.quality = quality;
    this.chunks = new Map();
    this.active = [];
  }

  generateChunk(chunkIndex) {
    if (this.chunks.has(chunkIndex)) return;

    const rng = new SeededRandom(this.seed + chunkIndex * 3571 + 9157);
    const zBase = chunkIndex * CHUNK_SIZE;
    const group = new THREE.Group();
    const items = [];

    const addDecor = (mesh, x, z, offsetY = 0) => {
      mesh.position.set(x, offsetY, z);
      mesh.userData.x = x;
      mesh.userData.z = z;
      mesh.userData.offsetY = offsetY;
      mesh.userData.phase = rng.range(0, Math.PI * 2);
      group.add(mesh);
      items.push(mesh);
      this.active.push(mesh);
    };

    const flagRows = this.quality === 'high' ? 5 : 3;
    for (let i = 0; i < flagRows; i++) {
      const z = zBase + 9 + i * (CHUNK_SIZE - 18) / Math.max(1, flagRows - 1) + rng.range(-2.5, 2.5);
      const color = i % 2 === 0 ? 0x2d7fff : 0xff5d64;
      addDecor(makeFlag(color, -1, rng), -TRACK_EDGE + rng.range(-1.2, 1.2), z);
      addDecor(makeFlag(color, 1, rng), TRACK_EDGE + rng.range(-1.2, 1.2), z + rng.range(-1.5, 1.5));
    }

    const gateCount = this.quality === 'high' ? 2 : 1;
    for (let i = 0; i < gateCount; i++) {
      addDecor(makeGate(rng), rng.range(-22, 22), zBase + rng.range(18, CHUNK_SIZE - 12));
    }

    if (this.quality === 'high') {
      for (let i = 0; i < 6; i++) {
        const side = rng.next() > 0.5 ? -1 : 1;
        addDecor(
          makeSnowStake(rng),
          side * rng.range(43, 51),
          zBase + rng.range(8, CHUNK_SIZE - 8),
        );
      }
    }

    this.scene.add(group);
    this.chunks.set(chunkIndex, { group, items });
  }

  update(dt, playerZ, groundYAt = null) {
    const currentChunk = Math.floor(playerZ / CHUNK_SIZE);

    for (let i = currentChunk - 1; i <= currentChunk + 5; i++) {
      this.generateChunk(i);
    }

    const t = performance.now() * 0.004;
    for (const mesh of this.active) {
      const x = mesh.userData.x;
      const z = mesh.userData.z;
      const groundY = groundYAt ? groundYAt(x, z) : 0;
      mesh.position.y = groundY + (mesh.userData.offsetY || 0);
      mesh.traverse(obj => {
        if (!obj.userData.wave) return;
        obj.rotation.y = Math.sin(t + mesh.userData.phase) * 0.12;
      });
    }

    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx < currentChunk - 3) {
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
