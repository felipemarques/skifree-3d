// @ts-nocheck
import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom';
import { getBiomeHueShiftAtZ } from './Biome';
import { makeTree, makeRock } from './Obstacles';

const CHUNK_SIZE = 80;
const TRACK_EDGE = 54;
// Border treeline band - fills the gap between the last on-track decor
// (snow stakes end around x=51) and the terrain's rendered width, so the
// sides of the run read as an actual forest edge instead of empty snow.
// The chase camera trails the player by 10 units and looks mostly forward
// (see Camera.ts), which gives it a fairly narrow horizontal field of view
// at short range - anything placed much past x~50 has already left frame
// by the time the player draws level with it, so it never registers as
// "enclosing" no matter how many are placed further out. INNER_MIN starts
// tight against the track (overlapping the existing non-colliding snow
// stakes at 43-51) specifically so trees stay in view all the way to
// close range; MID/OUTER add depth further back.
const INNER_MIN = 40;
const INNER_MAX = 58;
const MID_MAX = 80;
const BORDER_MAX = 108;

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

function makeEdgeMark(rng) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xff9a3d, roughness: 0.55, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rng.range(-0.08, 0.08);
  return mesh;
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

    // Ground-level trail-edge marks - flat dashes laid right at the
    // playable width's boundary (Obstacles.ts's TRACK_LIMIT=52) so the run
    // has a clear, unmissable edge regardless of terrain shading. The
    // shader's own corduroy edge band (SnowTerrain.ts) reads too subtly on
    // its own, so these are the primary edge marker.
    const markSpacing = this.quality === 'high' ? 6 : 10;
    for (const side of [-1, 1]) {
      for (let z = 3; z < CHUNK_SIZE; z += markSpacing) {
        addDecor(
          makeEdgeMark(rng),
          side * (52 + rng.range(-1, 1)),
          zBase + z + rng.range(-0.8, 0.8),
          0.02,
        );
      }
    }

    // Border treeline - purely decorative filler beyond the track so the
    // sides of the run aren't bare snow, and (via the INNER tier) close
    // enough to actually stay in view as the player passes. Reuses
    // Obstacles.ts's tree/rock factories for visual continuity with the
    // on-track props, but these never join any collision array.
    const { treeHueShift, rockHueShift } = getBiomeHueShiftAtZ(this.seed, zBase);
    const innerCount = this.quality === 'high' ? 14 : 6;
    const midCount = this.quality === 'high' ? 7 : 3;
    const outerCount = this.quality === 'high' ? 4 : 2;
    const makeFiller = () => (rng.next() < 0.72 ? makeTree(rng, treeHueShift) : makeRock(rng, rockHueShift));
    for (const side of [-1, 1]) {
      for (let i = 0; i < innerCount; i++) {
        const x = side * rng.range(INNER_MIN, INNER_MAX);
        const z = zBase + rng.range(2, CHUNK_SIZE - 2);
        addDecor(makeFiller(), x, z);
      }
      for (let i = 0; i < midCount; i++) {
        const x = side * rng.range(INNER_MAX, MID_MAX);
        const z = zBase + rng.range(3, CHUNK_SIZE - 3);
        addDecor(makeFiller(), x, z);
      }
      for (let i = 0; i < outerCount; i++) {
        const x = side * rng.range(MID_MAX, BORDER_MAX);
        const z = zBase + rng.range(4, CHUNK_SIZE - 4);
        addDecor(makeFiller(), x, z);
      }
    }

    this.scene.add(group);
    this.chunks.set(chunkIndex, { group, items });
    return group;
  }

  update(dt, playerZ, groundYAt = null) {
    const currentChunk = Math.floor(playerZ / CHUNK_SIZE);

    // Capped to 2 new chunks per frame - if the player suddenly covers a lot
    // of ground in one update (sustained boost, or catching up after some
    // other stall), several chunks in this window can still be missing at
    // once; generating them all synchronously was a real measured ~86ms
    // single-frame spike that could push cumulative frame time toward the
    // multiplayer snapshot-timeout watchdog (Game.ts, 5s). Spreading any
    // backlog across a couple of frames instead keeps this bounded - see
    // the matching obstacle-generation cap in Game.ts for the same fix.
    // Newly created groups are returned so Game.ts can shader-prewarm just
    // that group (renderer.compile is a full scene traversal - doing that
    // for the whole world every time one small chunk is added was itself a
    // measured ~50-70ms regression, worse than the spike it was meant to
    // avoid).
    const newGroups = [];
    let generatedThisFrame = 0;
    for (let i = currentChunk - 1; i <= currentChunk + 5 && generatedThisFrame < 2; i++) {
      if (!this.chunks.has(i)) {
        const group = this.generateChunk(i);
        if (group) newGroups.push(group);
        generatedThisFrame++;
      }
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

    return newGroups;
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
