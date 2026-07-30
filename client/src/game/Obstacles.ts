// @ts-nocheck
import * as THREE from 'three';
import { buildSkierMesh, updateSkierAnimation } from './SkierModel';
import { generateGameplayChunk, getRampedHazardVolume, getRampedRampVolume } from '../../../shared/AuthoritativeSim';
import { getBiomeHueShiftAtZ } from './Biome';

const CHUNK_SIZE = 80;
const CHUNK_WIDTH = 120;
const TRACK_LIMIT = CHUNK_WIDTH / 2 - 8;
// Mirrors shared/AuthoritativeSim.ts's RAMP_LANES: ramps rotate through
// lanes by chunk + spawn index instead of pure uniform-random x, so chaining
// requires actually crossing the track rather than holding a line.
const RAMP_LANES = [[-34, -14], [-9, 9], [14, 34]];
const OBSTACLES_PER_CHUNK = 18;
const NPC_SKIERS_PER_CHUNK = 2;
const NPC_DOGS_PER_CHUNK = 1;
const RAMPS_PER_CHUNK = 2;
const HOLES_PER_CHUNK = 2;
const HEARTS_PER_CHUNK = 1;
const HEART_MIN_DISTANCE = 70;
const BEAR_CHANCE_PER_CHUNK = 0.38;
const SOLID_OBSTACLE_TYPES = new Set(['tree', 'fallen_tree', 'rock', 'stump', 'ramp', 'hole']);
const NPC_JUMPABLE_TYPES = new Set(['hole', 'fallen_tree', 'stump', 'rock', 'bear', 'dog']);
const ANIMAL_JUMPABLE_TYPES = new Set(['hole', 'fallen_tree', 'stump', 'rock']);
const NPC_KNOCKDOWN_DURATION = 2.2;
const SPAWN_PADDING = 0.75;
// In a full blizzard, obstacles beyond this z-distance are hidden entirely
// (not just fogged) so nothing pops through via a shadow, specular hit, or
// any other fog-blend edge case - matches the fog's own z-distance framing.
const BLIZZARD_VISIBILITY_RADIUS = 22;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scaledCount(base, volume, minWhenNonZero = 0) {
  if (volume <= 0) return 0;
  return Math.max(minWhenNonZero, Math.round(base * volume));
}

function collidesAABB(ax, az, ahw, ahd, b, padding = 0) {
  return (
    Math.abs(ax - b.x) < (ahw + b.halfW + padding) &&
    Math.abs(az - b.z) < (ahd + b.halfD + padding)
  );
}

function findBlockingObstacle(obs, x, z, blockers, padding = 0.35) {
  for (const blocker of blockers) {
    if (blocker === obs || blocker.dead) continue;
    if (collidesAABB(x, z, obs.halfW, obs.halfD, blocker, padding)) return blocker;
  }
  return null;
}

function overlapsExistingSpawn(x, z, halfW, halfD, existing, padding = SPAWN_PADDING) {
  return existing.some(obs => collidesAABB(x, z, halfW, halfD, obs, padding));
}

function isTooCloseToType(x, z, type, minDistance, groups) {
  const minDistSq = minDistance * minDistance;
  for (const group of groups) {
    for (const obs of group) {
      if (obs.dead || obs.type !== type) continue;
      const dx = x - obs.x;
      const dz = z - obs.z;
      if (dx * dx + dz * dz < minDistSq) return true;
    }
  }
  return false;
}

function getAvoidSide(obs, blocker) {
  if (!blocker) return obs.lateralDir || 1;
  if (Math.abs(obs.x - blocker.x) > 0.1) return obs.x < blocker.x ? -1 : 1;
  return (obs.phase || 0) % 2 > 1 ? -1 : 1;
}

function getZigzagPulse(clock, interval, duration, phase) {
  if (!interval || !duration) return 0;
  const local = (clock + phase) % interval;
  if (local > duration) return 0;
  return Math.sin((local / duration) * Math.PI) * Math.sign(Math.sin(clock * 9.4 + phase));
}

function updateAnimalMotion(obs, dt, blockers, options = {}) {
  const {
    maxLateral = 4,
    maxForward = 2,
    blockerPadding = 0.4,
    jumpDuration = 0.5,
    highJump = 0.65,
    lowJump = 0.45,
    jumpCooldown = 1.1,
  } = options;

  if (obs.jumpCooldown > 0) obs.jumpCooldown = Math.max(0, obs.jumpCooldown - dt);
  if (obs.jumpTimer > 0) obs.jumpTimer = Math.max(0, obs.jumpTimer - dt);
  const airborne = obs.jumpTimer > 0;
  const clock = obs.animTime + obs.phase;
  const straightBias = Math.sin(clock * 0.37 + obs.phase * 1.9) > 0.35 ? 0.28 : 1;
  const zigzag = getZigzagPulse(clock, obs.zigzagInterval, obs.zigzagDuration, obs.phase) * obs.zigzagAmp;
  const weave =
    Math.sin(clock * obs.weaveFreq + obs.phase) * obs.weaveAmp +
    Math.sin(clock * obs.weaveFreq * 0.43 + obs.phase * 1.6) * obs.weaveAmp * 0.34;
  const centerPullX = (obs.patrolCenterX - obs.x) * 0.24;
  const targetVX = THREE.MathUtils.clamp(
    obs.lateralDir * obs.baseLateralSpeed * straightBias + weave + zigzag + centerPullX,
    -maxLateral,
    maxLateral,
  );

  const forwardWave = Math.sin(clock * obs.forwardFreq + obs.phase * 1.3) * obs.forwardSpeed * 0.55;
  const centerPullZ = (obs.patrolCenterZ - obs.z) * 0.32;
  const targetVZ = THREE.MathUtils.clamp(
    obs.forwardDir * obs.forwardSpeed * 0.55 + forwardWave + centerPullZ,
    -maxForward,
    maxForward,
  );

  obs.moveX = THREE.MathUtils.lerp(obs.moveX, targetVX, Math.min(1, obs.turnEase * dt));
  obs.moveZ = THREE.MathUtils.lerp(obs.moveZ, targetVZ, Math.min(1, obs.turnEase * dt));

  let nextX = obs.x + obs.moveX * dt;
  let nextZ = obs.z + obs.moveZ * dt;
  const left = Math.max(-TRACK_LIMIT, obs.patrolCenterX - obs.patrolRange);
  const right = Math.min(TRACK_LIMIT, obs.patrolCenterX + obs.patrolRange);
  const back = obs.patrolCenterZ - obs.patrolDepth;
  const front = obs.patrolCenterZ + obs.patrolDepth;

  if (nextX < left || nextX > right) {
    obs.lateralDir *= -1;
    obs.moveX = Math.abs(obs.moveX) * obs.lateralDir;
    nextX = THREE.MathUtils.clamp(obs.x + obs.moveX * dt, left, right);
  }

  if (nextZ < back || nextZ > front) {
    obs.forwardDir *= -1;
    obs.moveZ = Math.abs(obs.moveZ) * obs.forwardDir;
    nextZ = THREE.MathUtils.clamp(obs.z + obs.moveZ * dt, back, front);
  }

  const blocker = findBlockingObstacle(obs, nextX, nextZ, blockers, blockerPadding);
  if (blocker && !airborne && ANIMAL_JUMPABLE_TYPES.has(blocker.type) && obs.jumpCooldown <= 0) {
    obs.jumpDuration = jumpDuration;
    obs.jumpTimer = obs.jumpDuration;
    obs.jumpHeight = blocker.type === 'hole' || blocker.type === 'fallen_tree' ? highJump : lowJump;
    obs.jumpCooldown = jumpCooldown;
  } else if (blocker && !airborne) {
    const side = getAvoidSide(obs, blocker);
    obs.lateralDir = side;
    obs.moveX = side * maxLateral * 0.72;
    obs.moveZ *= 0.25;
    nextX = obs.x + obs.moveX * dt;
    nextZ = obs.z + obs.moveZ * dt;
    if (findBlockingObstacle(obs, nextX, nextZ, blockers, blockerPadding * 0.65)) {
      obs.forwardDir *= -1;
      obs.moveZ = Math.abs(obs.moveZ || obs.forwardSpeed) * obs.forwardDir;
      nextZ = obs.z + obs.moveZ * dt;
    }
  }

  obs.x = THREE.MathUtils.clamp(nextX, -TRACK_LIMIT, TRACK_LIMIT);
  obs.z = THREE.MathUtils.clamp(nextZ, back, front);
  obs.lateralSpeed = Math.hypot(obs.moveX, obs.moveZ);
  if (Math.abs(obs.moveX) > 0.05) obs.lateralDir = Math.sign(obs.moveX);
  if (Math.abs(obs.moveZ) > 0.05) obs.forwardDir = Math.sign(obs.moveZ);
  return { airborne, speed: obs.lateralSpeed };
}

function knockdownNpc(npc, source) {
  if (!npc || npc.dead || npc.type !== 'npc' || npc.knockdownTimer > 0 || npc.jumpTimer > 0) return false;

  npc.knockdownTimer = NPC_KNOCKDOWN_DURATION;
  npc.jumpTimer = 0;
  npc.jumpDuration = 0;
  npc.jumpHeight = 0;
  npc.speed = Math.max(1.2, npc.speed * 0.18);
  npc.lateralSpeed = (npc.x < source.x ? -1 : 1) * 1.1;
  return true;
}

function knockdownNearbyNpcSkiers(enemy, active) {
  for (const npc of active) {
    if (npc.type !== 'npc' || npc.dead || npc.knockdownTimer > 0 || npc.jumpTimer > 0) continue;
    if (Math.abs(npc.z - enemy.z) > 3.2 || Math.abs(npc.x - enemy.x) > 2.5) continue;
    if (collidesAABB(enemy.x, enemy.z, enemy.halfW, enemy.halfD, npc, 0.22)) {
      knockdownNpc(npc, enemy);
      return true;
    }
  }
  return false;
}

function markShadows(group) {
  group.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

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

function rememberRest(obj) {
  obj.userData.restPosition = obj.position.clone();
  obj.userData.restRotation = obj.rotation.clone();
  return obj;
}

function resetAnimalPart(obj) {
  if (!obj?.userData?.restPosition || !obj?.userData?.restRotation) return;
  obj.position.copy(obj.userData.restPosition);
  obj.rotation.copy(obj.userData.restRotation);
}

export function makeTree(rng, hueShift = 0) {
  const group = new THREE.Group();

  const trunkH = rng.range(0.55, 1.25);
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.17, trunkH, 5);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.52, rng.range(0.2, 0.32)),
    roughness: 0.9,
  });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = trunkH / 2;
  group.add(trunk);

  const layers = rng.int(2, 4);
  const baseScale = rng.range(0.78, 1.45);
  const greenHue = (((0.32 + rng.range(-0.035, 0.025) + hueShift) % 1) + 1) % 1;
  const snowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.56, 0.32, rng.range(0.86, 0.94)),
    roughness: 0.82,
  });

  for (let l = 0; l < layers; l++) {
    const r = (baseScale * (layers - l)) / layers;
    const h = r * rng.range(1.38, 1.68);
    const coneGeo = new THREE.ConeGeometry(r, h, 6);
    const coneMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(greenHue, rng.range(0.48, 0.62), 0.2 + l * 0.045),
      roughness: 0.86,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = trunkH + l * h * 0.42 + h / 2;
    cone.rotation.y = rng.range(0, Math.PI);
    group.add(cone);

    const capGeo = new THREE.ConeGeometry(r * 0.62, h * 0.28, 6);
    const cap = new THREE.Mesh(capGeo, snowMat);
    cap.position.y = cone.position.y + h * 0.28;
    cap.rotation.y = cone.rotation.y + 0.2;
    group.add(cap);
  }

  group.rotation.y = rng.range(0, Math.PI * 2);
  group.userData.halfW = baseScale * 0.72;
  group.userData.halfD = baseScale * 0.72;
  group.userData.type = 'tree';
  return markShadows(group);
}

export function makeRock(rng, hueShift = 0) {
  const group = new THREE.Group();
  const radius = rng.range(0.34, 0.82);
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  geo.scale(1.15, rng.range(0.48, 0.75), 0.9);
  const rockHue = (((0.6 + hueShift * 0.4) % 1) + 1) % 1;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(rockHue, 0.06, rng.range(0.34, 0.5)),
    roughness: 0.84,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = radius * 0.35;
  mesh.rotation.y = rng.range(0, Math.PI);
  group.add(mesh);

  const snow = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 0.58, 0),
    new THREE.MeshStandardMaterial({ color: 0xe6f3ff, roughness: 0.72 }),
  );
  snow.scale.set(1.05, 0.18, 0.82);
  snow.position.y = radius * 0.68;
  snow.rotation.y = mesh.rotation.y * 0.6;
  group.add(snow);

  group.userData.halfW = radius * 0.95;
  group.userData.halfD = radius * 0.85;
  group.userData.type = 'rock';
  return markShadows(group);
}

function makeStump(rng) {
  const group = new THREE.Group();
  const h = rng.range(0.16, 0.42);
  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, h, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a2e0a, roughness: 0.92 }),
  );
  stump.position.y = h / 2;
  group.add(stump);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.24, 0.04, 6),
    new THREE.MeshStandardMaterial({ color: 0xe4f3ff, roughness: 0.72 }),
  );
  cap.position.y = h + 0.025;
  group.add(cap);

  group.userData.halfW = 0.3;
  group.userData.halfD = 0.3;
  group.userData.type = 'stump';
  return markShadows(group);
}

function makeFallenTree(rng) {
  const group = new THREE.Group();

  const length = rng.range(2.2, 4.2);
  const radius = rng.range(0.16, 0.28);
  const barkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.48, rng.range(0.2, 0.32)),
    roughness: 0.92,
  });
  const cutMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.1, 0.45, rng.range(0.48, 0.62)),
    roughness: 0.82,
  });
  const snowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.56, 0.3, rng.range(0.84, 0.94)),
    roughness: 0.74,
  });

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.82, radius, length, 7),
    barkMat,
  );
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = radius * 0.95;
  group.add(trunk);

  for (const side of [-1, 1]) {
    const cut = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.84, radius * 0.84, 0.045, 7),
      cutMat,
    );
    cut.rotation.z = Math.PI / 2;
    cut.position.set(side * length * 0.51, radius * 0.95, 0);
    group.add(cut);
  }

  const snowCap = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.82, radius * 0.32, radius * 1.02),
    snowMat,
  );
  snowCap.position.y = radius * 1.54;
  snowCap.position.z = -radius * 0.04;
  snowCap.rotation.z = rng.range(-0.06, 0.06);
  group.add(snowCap);

  const branchCount = rng.int(2, 5);
  for (let i = 0; i < branchCount; i++) {
    const branchLength = rng.range(0.42, 0.9);
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.18, radius * 0.28, branchLength, 5),
      barkMat,
    );
    branch.position.set(
      rng.range(-length * 0.38, length * 0.38),
      radius * rng.range(0.82, 1.18),
      rng.range(-0.08, 0.08),
    );
    branch.rotation.x = Math.PI / 2 + rng.range(-0.55, 0.55);
    branch.rotation.z = rng.range(-0.9, 0.9);
    group.add(branch);
  }

  const angle = rng.range(0, Math.PI);
  const trunkHalf = length * 0.52;
  const thickHalf = Math.max(0.42, radius * 2.2);
  group.rotation.y = angle;
  group.userData.halfW = Math.abs(Math.cos(angle)) * trunkHalf + Math.abs(Math.sin(angle)) * thickHalf;
  group.userData.halfD = Math.abs(Math.sin(angle)) * trunkHalf + Math.abs(Math.cos(angle)) * thickHalf;
  group.userData.type = 'fallen_tree';
  group.userData.visualYOffset = 0.02;
  return markShadows(group);
}

function makeRamp(rng) {
  const group = new THREE.Group();
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(3.7, 0.42, 2.7),
    new THREE.MeshStandardMaterial({ color: 0xdfdac7, roughness: 0.72 }),
  );
  ramp.rotation.x = -0.32;
  ramp.position.y = 0.18;
  group.add(ramp);

  const crest = new THREE.Mesh(
    new THREE.BoxGeometry(3.55, 0.08, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xf2f7fb, roughness: 0.58 }),
  );
  crest.position.set(0, 0.42, -1.05);
  crest.rotation.x = -0.32;
  group.add(crest);

  group.rotation.y = rng.range(-0.06, 0.06);
  group.userData.halfW = 1.85;
  group.userData.halfD = 1.35;
  group.userData.type = 'ramp';
  return markShadows(group);
}

function createFilledXZGeometry(points, y = 0) {
  const positions = [0, y, 0];
  const indices = [];

  for (const p of points) {
    positions.push(p.x, y, p.z);
  }

  for (let i = 1; i <= points.length; i++) {
    const next = i === points.length ? 1 : i + 1;
    indices.push(0, i, next);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createRingXZGeometry(inner, outer, y = 0) {
  const positions = [];
  const indices = [];

  for (let i = 0; i < inner.length; i++) {
    positions.push(outer[i].x, y, outer[i].z);
    positions.push(inner[i].x, y, inner[i].z);
  }

  for (let i = 0; i < inner.length; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % inner.length) * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeIrregularOvalHolePoints(rng, width, depth, count = 18) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const rough = 0.82 + rng.next() * 0.34;
    const notch = 1 + Math.sin(a * rng.range(2.0, 4.5) + rng.range(0, Math.PI * 2)) * 0.08;
    points.push({
      x: Math.cos(a) * width * 0.5 * rough * notch,
      z: Math.sin(a) * depth * 0.5 * rough,
    });
  }
  return points;
}

function makeChippedRectangleHolePoints(rng, width, depth) {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const inset = () => rng.range(-0.22, 0.22);

  return [
    { x: -hw + inset(), z: -hd + rng.range(0, 0.18) },
    { x: -hw * rng.range(0.52, 0.78), z: -hd + inset() },
    { x: -hw * rng.range(0.18, 0.38), z: -hd + rng.range(-0.08, 0.14) },
    { x: hw * rng.range(0.2, 0.42), z: -hd + inset() },
    { x: hw * rng.range(0.62, 0.86), z: -hd + rng.range(-0.1, 0.16) },
    { x: hw + rng.range(-0.16, 0.12), z: -hd * rng.range(0.45, 0.76) },
    { x: hw + inset(), z: -hd * rng.range(0.05, 0.28) },
    { x: hw + rng.range(-0.12, 0.18), z: hd * rng.range(0.22, 0.52) },
    { x: hw * rng.range(0.58, 0.9), z: hd + inset() },
    { x: hw * rng.range(0.12, 0.38), z: hd + rng.range(-0.12, 0.16) },
    { x: -hw * rng.range(0.18, 0.44), z: hd + inset() },
    { x: -hw * rng.range(0.58, 0.88), z: hd + rng.range(-0.1, 0.18) },
    { x: -hw + rng.range(-0.14, 0.14), z: hd * rng.range(0.42, 0.74) },
    { x: -hw + inset(), z: hd * rng.range(-0.18, 0.18) },
  ];
}

function makeCrevasseHolePoints(rng, width, depth) {
  const points = [];
  const steps = 8;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const z = -depth * 0.5 + t * depth;
    const edge = -width * 0.5 + rng.range(-0.12, 0.18) + Math.sin(t * Math.PI * 3) * width * 0.08;
    points.push({ x: edge, z });
  }

  for (let i = steps - 1; i >= 0; i--) {
    const t = i / (steps - 1);
    const z = -depth * 0.5 + t * depth;
    const edge = width * 0.5 + rng.range(-0.18, 0.12) + Math.sin(t * Math.PI * 2.4 + 1.2) * width * 0.06;
    points.push({ x: edge, z });
  }

  return points;
}

function scalePoints(points, scale) {
  return points.map(p => ({ x: p.x * scale, z: p.z * scale }));
}

function getRotatedExtents(points, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let halfW = 0;
  let halfD = 0;

  for (const p of points) {
    const x = p.x * c + p.z * s;
    const z = -p.x * s + p.z * c;
    halfW = Math.max(halfW, Math.abs(x));
    halfD = Math.max(halfD, Math.abs(z));
  }

  return { halfW, halfD };
}

function makeHole(rng) {
  const group = new THREE.Group();

  const variant = rng.next();
  let width;
  let depth;
  let points;

  if (variant < 0.38) {
    width = rng.range(2.3, 3.35);
    depth = rng.range(1.25, 2.05);
    points = makeIrregularOvalHolePoints(rng, width, depth, rng.int(16, 22));
  } else if (variant < 0.76) {
    width = rng.range(2.5, 3.75);
    depth = rng.range(1.45, 2.35);
    points = makeChippedRectangleHolePoints(rng, width, depth);
  } else {
    width = rng.range(1.45, 2.1);
    depth = rng.range(2.8, 4.15);
    points = makeCrevasseHolePoints(rng, width, depth);
  }

  const outer = scalePoints(points, rng.range(1.1, 1.22));
  const innerShadow = scalePoints(points, rng.range(0.45, 0.58));

  const pit = new THREE.Mesh(
    createFilledXZGeometry(points, 0.018),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.56, 0.24, rng.range(0.26, 0.34)),
      roughness: 0.98,
      metalness: 0,
    }),
  );
  group.add(pit);

  const rim = new THREE.Mesh(
    createRingXZGeometry(points, outer, 0.045),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.56, 0.28, rng.range(0.82, 0.91)),
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  group.add(rim);

  const shadow = new THREE.Mesh(
    createFilledXZGeometry(innerShadow, 0.052),
    new THREE.MeshBasicMaterial({
      color: 0x1f303c,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    }),
  );
  group.add(shadow);

  const crackMat = new THREE.MeshBasicMaterial({
    color: 0x2b4556,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  });
  const crackCount = rng.int(2, 4);
  for (let i = 0; i < crackCount; i++) {
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(rng.range(0.08, 0.13), rng.range(0.45, 0.95)),
      crackMat,
    );
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = rng.range(0, Math.PI);
    crack.position.set(rng.range(-width * 0.28, width * 0.28), 0.057, rng.range(-depth * 0.26, depth * 0.26));
    group.add(crack);
  }

  const rotation = rng.range(0, Math.PI);
  const extents = getRotatedExtents(outer, rotation);
  group.rotation.y = rotation;
  group.userData.halfW = extents.halfW;
  group.userData.halfD = extents.halfD;
  group.userData.type = 'hole';
  group.userData.visualYOffset = 0.015;
  return group;
}

function makeHeartPickup(rng) {
  const group = new THREE.Group();
  const heartMat = new THREE.MeshStandardMaterial({
    color: 0xff4f7b,
    emissive: 0x5c0b1f,
    emissiveIntensity: 0.22,
    roughness: 0.46,
    metalness: 0.02,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff9ab1,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  const left = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), heartMat);
  left.scale.set(1.0, 0.9, 0.72);
  left.position.set(-0.13, 0.78, 0);
  group.add(left);

  const right = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), heartMat);
  right.scale.set(1.0, 0.9, 0.72);
  right.position.set(0.13, 0.78, 0);
  group.add(right);

  const point = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.48, 4), heartMat);
  point.position.set(0, 0.52, 0);
  point.rotation.y = Math.PI * 0.25;
  point.rotation.z = Math.PI;
  group.add(point);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.44, 10, 8), glowMat);
  glow.scale.set(1.05, 0.85, 0.65);
  glow.position.y = 0.65;
  group.add(glow);

  group.userData.halfW = 0.46;
  group.userData.halfD = 0.46;
  group.userData.type = 'heart';
  group.userData.phase = rng.range(0, Math.PI * 2);
  group.userData.visualYOffset = 0.04;
  return markShadows(group);
}

function makeNPCSkier(rng) {
  const color = new THREE.Color().setHSL(rng.next(), 0.68, 0.52);
  const scarf = new THREE.Color().setHSL(rng.next(), 0.7, 0.62);
  const group = buildSkierMesh(color, {
    helmetColor: color,
    scarfColor: scarf,
    scale: 0.86,
  });

  group.userData.halfW = 0.3;
  group.userData.halfD = 0.45;
  group.userData.type = 'npc';
  group.userData.speed = rng.range(3.2, 7.4);
  group.userData.baseSpeed = group.userData.speed;
  group.userData.minSpeed = rng.range(2.4, 4.2);
  group.userData.maxSpeed = rng.range(6.2, 9.8);
  group.userData.speedFreq = rng.range(0.12, 0.28);
  group.userData.lateralSpeed = rng.range(-1.5, 1.5);
  group.userData.weaveAmp = rng.range(1.4, 4.2);
  group.userData.weaveFreq = rng.range(0.42, 0.92);
  group.userData.turnEase = rng.range(1.8, 3.8);
  group.userData.driftBias = rng.range(-0.75, 0.75);
  group.userData.zigzagInterval = rng.range(4.5, 8.5);
  group.userData.zigzagDuration = rng.range(1.0, 1.8);
  group.userData.zigzagAmp = rng.range(2.2, 4.8);
  return group;
}

function makeDog(rng) {
  const group = new THREE.Group();
  const parts = {
    legs: [],
  };
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.08, rng.range(0.32, 0.55)),
    roughness: 0.85,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.8), mat);
  body.position.y = 0.35;
  group.add(body);
  parts.body = rememberRest(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.35), mat);
  head.position.set(0, 0.52, 0.38);
  group.add(head);
  parts.head = rememberRest(head);

  for (let lx = -1; lx <= 1; lx += 2) {
    for (let lz = -1; lz <= 1; lz += 2) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat);
      leg.position.set(lx * 0.17, 0.12, lz * 0.28);
      leg.userData.side = lx;
      leg.userData.stride = lz;
      group.add(leg);
      parts.legs.push(rememberRest(leg));
    }
  }

  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.025, 0.38, 5),
    mat,
  );
  tail.position.set(0, 0.48, -0.48);
  tail.rotation.x = -0.72;
  group.add(tail);
  parts.tail = rememberRest(tail);

  group.userData.halfW = 0.35;
  group.userData.halfD = 0.5;
  group.userData.type = 'dog';
  group.userData.lateralSpeed = rng.range(1.4, 3.2);
  group.userData.lateralDir = rng.next() > 0.5 ? 1 : -1;
  group.userData.forwardSpeed = rng.range(0.7, 2.1);
  group.userData.forwardDir = rng.next() > 0.5 ? 1 : -1;
  group.userData.patrolRange = rng.range(5.5, 11);
  group.userData.patrolDepth = rng.range(4.2, 9.5);
  group.userData.weaveAmp = rng.range(0.65, 1.85);
  group.userData.weaveFreq = rng.range(0.62, 1.24);
  group.userData.forwardFreq = rng.range(0.34, 0.82);
  group.userData.turnEase = rng.range(3.8, 6.8);
  group.userData.zigzagInterval = rng.range(3.2, 6.8);
  group.userData.zigzagDuration = rng.range(0.55, 1.35);
  group.userData.zigzagAmp = rng.range(0.9, 2.4);
  group.userData.phase = rng.range(0, Math.PI * 2);
  group.userData.animalParts = parts;
  return markShadows(group);
}

function makePolarBear(rng) {
  const group = new THREE.Group();
  const parts = {
    legs: [],
    ears: [],
    eyes: [],
  };
  const furMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.57, 0.25, rng.range(0.83, 0.93)),
    roughness: 0.82,
  });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 0.78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x17202a, roughness: 0.72 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), furMat);
  body.scale.set(1.45, 0.62, 0.82);
  body.position.y = 0.62;
  group.add(body);
  parts.body = rememberRest(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.46, 8, 5), bellyMat);
  belly.scale.set(1.2, 0.42, 0.62);
  belly.position.set(0, 0.56, 0.12);
  group.add(belly);
  parts.belly = rememberRest(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), furMat);
  head.position.set(0, 0.86, 0.65);
  group.add(head);
  parts.head = rememberRest(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.28), bellyMat);
  snout.position.set(0, 0.8, 0.9);
  group.add(snout);
  parts.snout = rememberRest(snout);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), darkMat);
  nose.position.set(0, 0.82, 1.06);
  group.add(nose);
  parts.nose = rememberRest(nose);

  for (let side = -1; side <= 1; side += 2) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.105, 6, 4), furMat);
    ear.position.set(side * 0.24, 1.09, 0.54);
    group.add(ear);
    ear.userData.side = side;
    parts.ears.push(rememberRest(ear));

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), darkMat);
    eye.position.set(side * 0.11, 0.91, 0.94);
    group.add(eye);
    eye.userData.side = side;
    parts.eyes.push(rememberRest(eye));

    for (const z of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.18), furMat);
      leg.position.set(side * 0.38, 0.22, z);
      leg.userData.side = side;
      leg.userData.stride = z > 0 ? 1 : -1;
      group.add(leg);
      parts.legs.push(rememberRest(leg));
    }
  }

  group.userData.halfW = 0.82;
  group.userData.halfD = 1.18;
  group.userData.type = 'bear';
  group.userData.lateralSpeed = rng.range(1.1, 2.4);
  group.userData.lateralDir = rng.next() > 0.5 ? 1 : -1;
  group.userData.forwardSpeed = rng.range(0.35, 1.25);
  group.userData.forwardDir = rng.next() > 0.5 ? 1 : -1;
  group.userData.patrolRange = rng.range(5.5, 10.5);
  group.userData.patrolDepth = rng.range(2.5, 6.5);
  group.userData.weaveAmp = rng.range(0.35, 1.15);
  group.userData.weaveFreq = rng.range(0.34, 0.72);
  group.userData.forwardFreq = rng.range(0.22, 0.52);
  group.userData.turnEase = rng.range(2.4, 4.6);
  group.userData.zigzagInterval = rng.range(5.2, 9.5);
  group.userData.zigzagDuration = rng.range(0.8, 1.6);
  group.userData.zigzagAmp = rng.range(0.45, 1.35);
  group.userData.phase = rng.range(0, Math.PI * 2);
  group.userData.animalParts = parts;
  return markShadows(group);
}

function animateDog(mesh, dt, moveSpeed, phase) {
  const parts = mesh.userData.animalParts;
  if (!parts) return;

  const speed01 = THREE.MathUtils.clamp(Math.abs(moveSpeed) / 5, 0.2, 1);
  const t = phase;
  const stepAmp = 0.34 * speed01;
  const bob = Math.abs(Math.sin(t * 2)) * 0.035 * speed01;

  for (const part of [parts.body, parts.head, parts.tail, ...parts.legs]) {
    resetAnimalPart(part);
  }

  if (parts.body) {
    parts.body.position.y += bob;
    parts.body.position.z += Math.cos(t * 2.2) * 0.018 * speed01;
    parts.body.rotation.z += Math.sin(t) * 0.055;
    parts.body.rotation.x += Math.cos(t * 1.1) * 0.055;
  }

  if (parts.head) {
    parts.head.position.y += bob + Math.sin(t * 1.7) * 0.028;
    parts.head.position.z += Math.cos(t * 2.2) * 0.025 * speed01;
    parts.head.rotation.y += Math.sin(t * 0.75) * 0.1;
    parts.head.rotation.x += Math.cos(t * 1.4) * 0.075;
  }

  if (parts.tail) {
    parts.tail.rotation.z += Math.sin(t * 3.1) * 0.42;
    parts.tail.rotation.x += Math.cos(t * 1.5) * 0.12;
  }

  for (const leg of parts.legs) {
    const side = leg.userData.side || 1;
    const stride = leg.userData.stride || 1;
    const gait = Math.sin(t * 2.2 + side * stride * Math.PI * 0.5);
    const lift = Math.max(0, gait) * 0.07 * speed01;
    leg.position.y += bob * 0.35 + lift;
    leg.position.z += gait * 0.08 * speed01 * stride;
    leg.rotation.x += gait * stepAmp;
    leg.rotation.z += side * Math.max(0, -gait) * 0.08 * speed01;
  }
}

function animateBear(mesh, dt, moveSpeed, phase) {
  const parts = mesh.userData.animalParts;
  if (!parts) return;

  const speed01 = THREE.MathUtils.clamp(Math.abs(moveSpeed) / 3.4, 0.25, 1);
  const t = phase;
  const bob = Math.abs(Math.sin(t * 1.35)) * 0.045 * speed01;

  for (const part of [
    parts.body,
    parts.belly,
    parts.head,
    parts.snout,
    parts.nose,
    ...parts.ears,
    ...parts.eyes,
    ...parts.legs,
  ]) {
    resetAnimalPart(part);
  }

  for (const part of [parts.body, parts.belly]) {
    if (!part) continue;
    part.position.y += bob;
    part.position.z += Math.cos(t * 1.35) * 0.025 * speed01;
    part.rotation.x += Math.sin(t * 0.8) * 0.06;
    part.rotation.z += Math.sin(t * 1.1) * 0.065;
  }

  for (const part of [parts.head, parts.snout, parts.nose, ...parts.ears, ...parts.eyes]) {
    if (!part) continue;
    part.position.y += bob + Math.sin(t * 1.15) * 0.026;
    part.position.z += Math.cos(t * 1.35) * 0.03 * speed01;
    part.rotation.y += Math.sin(t * 0.65) * 0.1;
    part.rotation.x += Math.cos(t * 1.05) * 0.06;
  }

  for (const leg of parts.legs) {
    const side = leg.userData.side || 1;
    const stride = leg.userData.stride || 1;
    const gait = Math.sin(t * 1.7 + side * stride * Math.PI * 0.65);
    const lift = Math.max(0, gait) * 0.055 * speed01;
    leg.position.y += lift;
    leg.position.z += gait * 0.07 * speed01 * stride;
    leg.rotation.x += gait * 0.32 * speed01;
    leg.rotation.z += side * (Math.sin(t * 0.8) * 0.055 + Math.max(0, -gait) * 0.045 * speed01);
  }
}

export class Obstacles {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.volume = clamp(Number(options.volume ?? 1), 0, 2);
    this.authoritativeSeed = options.authoritativeSeed ?? null;
    this.difficultyRamp = !!options.difficultyRamp;
    this.chunks = new Map();
    this.active = [];
  }

  generateChunk(chunkIndex, rng, chainBoost = false) {
    if (this.chunks.has(chunkIndex)) return;
    if (this.authoritativeSeed !== null && this.authoritativeSeed !== undefined) {
      this.generateAuthoritativeChunk(chunkIndex, rng);
      return;
    }

    const zBase = chunkIndex * CHUNK_SIZE;
    const { treeHueShift, rockHueShift } = getBiomeHueShiftAtZ(zBase);
    const group = new THREE.Group();
    const chunkObstacles = [];
    // Only the hazard categories that also exist in the shared authoritative
    // sim ramp with distance, so the "difficulty ramp" feature means the
    // same thing in solo as it does in a multiplayer lobby; NPC/dog/bear are
    // solo-exclusive extras and stay on the base volume.
    const hazardVolume = getRampedHazardVolume(this.volume, chunkIndex, this.difficultyRamp);
    // Solo-only: chunks not yet generated when the player has an active jump
    // chain get more ramps, to help keep it going. Safe only because this
    // chunk gets cached forever the moment it's generated (see chunks.has
    // above) - a live signal like this can't safely drive the multiplayer
    // authoritative path, which recomputes obstacles fresh every tick and
    // must stay identical between server and every client.
    const rampVolume = getRampedRampVolume(this.volume, chunkIndex, this.difficultyRamp) * (chainBoost ? 1.8 : 1);
    const counts = {
      static: scaledCount(OBSTACLES_PER_CHUNK, hazardVolume),
      ramps: scaledCount(RAMPS_PER_CHUNK, rampVolume, 1),
      holes: scaledCount(HOLES_PER_CHUNK, hazardVolume),
      hearts: scaledCount(HEARTS_PER_CHUNK, Math.max(this.volume, 0.5), 1),
      npcSkiers: scaledCount(NPC_SKIERS_PER_CHUNK, this.volume),
      dogs: scaledCount(NPC_DOGS_PER_CHUNK, this.volume),
      bearChance: clamp(BEAR_CHANCE_PER_CHUNK * this.volume, 0, 0.85),
    };

    const spawnObs = (mesh, x, z) => {
      mesh.position.set(x, 0, z);
      group.add(mesh);
      chunkObstacles.push({
        x,
        z,
        halfW: mesh.userData.halfW,
        halfD: mesh.userData.halfD,
        type: mesh.userData.type,
        mesh,
        dead: false,
        speed: mesh.userData.speed || 0,
        baseSpeed: mesh.userData.baseSpeed || mesh.userData.speed || 0,
        minSpeed: mesh.userData.minSpeed || 0,
        maxSpeed: mesh.userData.maxSpeed || mesh.userData.speed || 0,
        speedFreq: mesh.userData.speedFreq || 0,
        lateralSpeed: mesh.userData.lateralSpeed || 0,
        baseLateralSpeed: mesh.userData.lateralSpeed || 0,
        lateralDir: mesh.userData.lateralDir || 1,
        forwardSpeed: mesh.userData.forwardSpeed || 0,
        forwardDir: mesh.userData.forwardDir || 1,
        forwardFreq: mesh.userData.forwardFreq || 0.35,
        moveX: (mesh.userData.lateralSpeed || 0) * (mesh.userData.lateralDir || 1),
        moveZ: (mesh.userData.forwardSpeed || 0) * (mesh.userData.forwardDir || 1),
        weaveAmp: mesh.userData.weaveAmp || 0,
        weaveFreq: mesh.userData.weaveFreq || 0,
        turnEase: mesh.userData.turnEase || 2,
        driftBias: mesh.userData.driftBias || 0,
        zigzagInterval: mesh.userData.zigzagInterval || 0,
        zigzagDuration: mesh.userData.zigzagDuration || 0,
        zigzagAmp: mesh.userData.zigzagAmp || 0,
        jumpTimer: 0,
        jumpDuration: 0,
        jumpHeight: 0,
        jumpCooldown: rng.range(0.2, 1.1),
        knockdownTimer: 0,
        patrolCenterX: x,
        patrolRange: mesh.userData.patrolRange || 0,
        patrolCenterZ: z,
        patrolDepth: mesh.userData.patrolDepth || 0,
        phase: mesh.userData.phase || rng.range(0, Math.PI * 2),
        animTime: rng.range(0, Math.PI * 2),
        visualYOffset: mesh.userData.visualYOffset || 0,
        chunkIndex,
      });
    };

    const spawnPlaced = (factory, xRange, zRange, options = {}) => {
      const {
        attempts = 12,
        padding = SPAWN_PADDING,
        requireClear = true,
        minDistanceFromType = null,
        minDistance = 0,
      } = options;

      for (let attempt = 0; attempt < attempts; attempt++) {
        const mesh = factory();
        const x = rng.range(xRange[0], xRange[1]);
        const z = zBase + rng.range(zRange[0], zRange[1]);
        if (
          (
            !requireClear ||
            !overlapsExistingSpawn(x, z, mesh.userData.halfW, mesh.userData.halfD, chunkObstacles, padding)
          ) &&
          (
            !minDistanceFromType ||
            !isTooCloseToType(x, z, minDistanceFromType, minDistance, [chunkObstacles, this.active])
          )
        ) {
          spawnObs(mesh, x, z);
          return true;
        }
        disposeGroup(mesh);
      }

      return false;
    };

    for (let i = 0; i < counts.static; i++) {
      const r = rng.next();
      if (r < 0.44) spawnPlaced(() => makeTree(rng, treeHueShift), [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
      else if (r < 0.62) spawnPlaced(() => makeFallenTree(rng), [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
      else if (r < 0.8) spawnPlaced(() => makeRock(rng, rockHueShift), [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
      else spawnPlaced(() => makeStump(rng), [-TRACK_LIMIT, TRACK_LIMIT], [8, CHUNK_SIZE - 8]);
    }

    for (let i = 0; i < counts.ramps; i++) {
      const lane = RAMP_LANES[((chunkIndex + i) % RAMP_LANES.length + RAMP_LANES.length) % RAMP_LANES.length];
      spawnPlaced(() => makeRamp(rng), lane, [12, CHUNK_SIZE - 12], {
        attempts: 18,
        padding: 1.1,
      });
    }

    for (let i = 0; i < counts.holes; i++) {
      spawnPlaced(() => makeHole(rng), [-42, 42], [14, CHUNK_SIZE - 10], {
        attempts: 14,
        padding: 0.9,
      });
    }

    for (let i = 0; i < counts.hearts; i++) {
      spawnPlaced(() => makeHeartPickup(rng), [-34, 34], [18, CHUNK_SIZE - 12], {
        attempts: 24,
        padding: 0.35,
        minDistanceFromType: 'heart',
        minDistance: HEART_MIN_DISTANCE,
      });
    }

    if (chunkIndex > 1 && rng.next() < counts.bearChance) {
      spawnPlaced(() => makePolarBear(rng), [-38, 38], [18, CHUNK_SIZE - 14], {
        attempts: 12,
        padding: 0.9,
      });
    }

    for (let i = 0; i < counts.npcSkiers; i++) {
      spawnPlaced(() => makeNPCSkier(rng), [-40, 40], [10, CHUNK_SIZE - 10], {
        attempts: 10,
        padding: 0.55,
      });
    }

    for (let i = 0; i < counts.dogs; i++) {
      spawnPlaced(() => makeDog(rng), [-40, 40], [10, CHUNK_SIZE - 10], {
        attempts: 10,
        padding: 0.55,
      });
    }

    this.scene.add(group);
    this.chunks.set(chunkIndex, { group, obstacles: chunkObstacles });
    this.active.push(...chunkObstacles);
  }

  generateAuthoritativeChunk(chunkIndex, rng) {
    if (this.chunks.has(chunkIndex)) return;

    const group = new THREE.Group();
    const chunkObstacles = [];
    const records = generateGameplayChunk(this.authoritativeSeed, chunkIndex, this.volume, new Set(), this.difficultyRamp);
    const { treeHueShift, rockHueShift } = getBiomeHueShiftAtZ(chunkIndex * CHUNK_SIZE);

    const makeMesh = (type) => {
      if (type === 'tree') return makeTree(rng, treeHueShift);
      if (type === 'fallen_tree') return makeFallenTree(rng);
      if (type === 'rock') return makeRock(rng, rockHueShift);
      if (type === 'stump') return makeStump(rng);
      if (type === 'ramp') return makeRamp(rng);
      if (type === 'hole') return makeHole(rng);
      if (type === 'heart') return makeHeartPickup(rng);
      return makeRock(rng, rockHueShift);
    };

    for (const record of records) {
      const mesh = makeMesh(record.type);
      mesh.position.set(record.x, 0, record.z);
      group.add(mesh);
      chunkObstacles.push({
        x: record.x,
        z: record.z,
        id: record.id,
        halfW: record.halfW,
        halfD: record.halfD,
        type: record.type,
        mesh,
        dead: false,
        speed: 0,
        baseSpeed: 0,
        minSpeed: 0,
        maxSpeed: 0,
        speedFreq: 0,
        lateralSpeed: 0,
        baseLateralSpeed: 0,
        lateralDir: 1,
        forwardSpeed: 0,
        forwardDir: 1,
        forwardFreq: 0,
        moveX: 0,
        moveZ: 0,
        weaveAmp: 0,
        weaveFreq: 0,
        turnEase: 2,
        driftBias: 0,
        zigzagInterval: 0,
        zigzagDuration: 0,
        zigzagAmp: 0,
        jumpTimer: 0,
        jumpDuration: 0,
        jumpHeight: 0,
        jumpCooldown: 0,
        knockdownTimer: 0,
        patrolCenterX: record.x,
        patrolRange: 0,
        patrolCenterZ: record.z,
        patrolDepth: 0,
        phase: rng.range(0, Math.PI * 2),
        animTime: rng.range(0, Math.PI * 2),
        visualYOffset: mesh.userData.visualYOffset || 0,
        chunkIndex,
      });
    }

    this.scene.add(group);
    this.chunks.set(chunkIndex, { group, obstacles: chunkObstacles });
    this.active.push(...chunkObstacles);
  }

  update(dt, playerZ, groundYAt = null, blizzardT = 0) {
    const currentChunk = Math.floor(playerZ / CHUNK_SIZE);
    const now = performance.now() * 0.004;
    const blockers = this.getAvoidanceBlockers(playerZ, CHUNK_SIZE * 2.2);
    const cullRadius = THREE.MathUtils.lerp(9999, BLIZZARD_VISIBILITY_RADIUS, THREE.MathUtils.clamp(blizzardT, 0, 1));

    for (const obs of this.active) {
      if (obs.dead) continue;

      if (obs.type === 'npc') {
        obs.animTime += dt * (2.4 + obs.speed * 0.32);
        if (obs.knockdownTimer > 0) {
          obs.knockdownTimer = Math.max(0, obs.knockdownTimer - dt);
          obs.speed = THREE.MathUtils.lerp(obs.speed, obs.minSpeed * 0.45, Math.min(1, dt * 2.2));
          obs.lateralSpeed = THREE.MathUtils.lerp(obs.lateralSpeed, 0, Math.min(1, dt * 1.8));
          obs.z += obs.speed * dt * 0.38;
          obs.x = THREE.MathUtils.clamp(obs.x + obs.lateralSpeed * dt, -TRACK_LIMIT, TRACK_LIMIT);
          obs.mesh.rotation.y = -Math.atan2(obs.lateralSpeed, Math.max(1, obs.speed));
          obs.mesh.rotation.x = -1.05;
          obs.mesh.rotation.z = Math.sin(obs.animTime * 6 + obs.phase) * 0.18;
          updateSkierAnimation(obs.mesh, {
            dt,
            speed: obs.speed * 0.25,
            steer: 0,
            airborne: false,
          });
          const groundY = groundYAt ? groundYAt(obs.x, obs.z) : 0;
          obs.mesh.position.set(obs.x, groundY + obs.visualYOffset + 0.06, obs.z);
          continue;
        }

        if (obs.jumpCooldown > 0) obs.jumpCooldown = Math.max(0, obs.jumpCooldown - dt);
        if (obs.jumpTimer > 0) obs.jumpTimer = Math.max(0, obs.jumpTimer - dt);
        const airborne = obs.jumpTimer > 0;

        const speedWave =
          Math.sin(obs.animTime * obs.speedFreq + obs.phase * 0.7) * 0.5 + 0.5;
        const burstWave =
          Math.sin(obs.animTime * obs.speedFreq * 0.41 + obs.phase * 1.9) * 0.5 + 0.5;
        const targetSpeed = THREE.MathUtils.lerp(
          obs.minSpeed,
          obs.maxSpeed,
          speedWave * 0.72 + burstWave * 0.28,
        );
        obs.speed = THREE.MathUtils.lerp(obs.speed, targetSpeed, Math.min(1, dt * 1.4));

        const zigzagClock = obs.zigzagInterval > 0
          ? (obs.animTime + obs.phase) % obs.zigzagInterval
          : obs.zigzagInterval;
        const zigzagActive = zigzagClock < obs.zigzagDuration;
        const zigzagFade = zigzagActive
          ? Math.sin((zigzagClock / obs.zigzagDuration) * Math.PI)
          : 0;

        const edgePush = Math.abs(obs.x) > TRACK_LIMIT * 0.78
          ? -Math.sign(obs.x) * THREE.MathUtils.mapLinear(Math.abs(obs.x), TRACK_LIMIT * 0.78, TRACK_LIMIT, 0, 3.8)
          : 0;
        const weave =
          Math.sin(obs.animTime * obs.weaveFreq + obs.phase) * obs.weaveAmp +
          Math.sin(obs.animTime * obs.weaveFreq * 0.43 + obs.phase * 1.7) * obs.weaveAmp * 0.35;
        const zigzag =
          Math.sign(Math.sin(obs.animTime * 9.2 + obs.phase)) *
          obs.zigzagAmp *
          zigzagFade;
        const targetLateralSpeed = THREE.MathUtils.clamp(
          weave + zigzag + obs.driftBias + edgePush,
          -5.8,
          5.8,
        );

        obs.lateralSpeed = THREE.MathUtils.lerp(
          obs.lateralSpeed,
          targetLateralSpeed,
          Math.min(1, obs.turnEase * dt),
        );

        let nextX = obs.x + obs.lateralSpeed * dt;
        let nextZ = obs.z + obs.speed * dt;
        const blocker = findBlockingObstacle(obs, nextX, nextZ, blockers, 0.55);
        if (blocker && !airborne && NPC_JUMPABLE_TYPES.has(blocker.type) && obs.jumpCooldown <= 0) {
          obs.jumpDuration = THREE.MathUtils.clamp(0.52 + obs.speed * 0.035, 0.55, 0.9);
          obs.jumpTimer = obs.jumpDuration;
          obs.jumpHeight = blocker.type === 'hole' || blocker.type === 'fallen_tree' ? 1.0 : 0.72;
          obs.jumpCooldown = 1.2;
        } else if (blocker && !airborne) {
          const side = getAvoidSide(obs, blocker);
          obs.lateralSpeed = THREE.MathUtils.lerp(obs.lateralSpeed, side * 3.4, Math.min(1, dt * 8));
          nextX = obs.x + obs.lateralSpeed * dt;
          nextZ = obs.z + obs.speed * dt * 0.45;
          if (findBlockingObstacle(obs, nextX, nextZ, blockers, 0.25)) {
            nextZ = obs.z - obs.speed * dt * 0.15;
          }
        }
        obs.z = nextZ;
        obs.x = nextX;
        obs.x = THREE.MathUtils.clamp(obs.x, -TRACK_LIMIT, TRACK_LIMIT);
        obs.mesh.rotation.y = -Math.atan2(obs.lateralSpeed, Math.max(1, obs.speed));
        obs.mesh.rotation.x = 0;
        obs.mesh.rotation.z = 0;
        updateSkierAnimation(obs.mesh, {
          dt,
          speed: obs.speed,
          steer: THREE.MathUtils.clamp(obs.lateralSpeed / 5.8, -1, 1),
          airborne,
          airTime: airborne ? obs.jumpDuration - obs.jumpTimer : 0,
        });
      } else if (obs.type === 'dog') {
        const motion = updateAnimalMotion(obs, dt, blockers, {
          maxLateral: 4.8,
          maxForward: 2.6,
          blockerPadding: 0.35,
          jumpDuration: 0.48,
          highJump: 0.62,
          lowJump: 0.42,
          jumpCooldown: 1.0,
        });
        if (motion.speed > 0.05) obs.mesh.rotation.y = Math.atan2(obs.moveX, obs.moveZ);
        obs.animTime += dt * (2.8 + motion.speed * 0.85);
        animateDog(obs.mesh, dt, motion.speed, obs.animTime + obs.phase);
        knockdownNearbyNpcSkiers(obs, this.active);
      } else if (obs.type === 'bear') {
        const motion = updateAnimalMotion(obs, dt, blockers, {
          maxLateral: 3.2,
          maxForward: 1.6,
          blockerPadding: 0.48,
          jumpDuration: 0.62,
          highJump: 0.72,
          lowJump: 0.5,
          jumpCooldown: 1.4,
        });
        if (motion.speed > 0.05) obs.mesh.rotation.y = Math.atan2(obs.moveX, obs.moveZ);
        obs.mesh.rotation.z = Math.sin(now + obs.phase) * 0.035;
        obs.animTime += dt * (1.4 + motion.speed * 0.55);
        animateBear(obs.mesh, dt, motion.speed, obs.animTime + obs.phase);
        knockdownNearbyNpcSkiers(obs, this.active);
      } else if (obs.type === 'heart') {
        obs.animTime += dt;
        obs.mesh.rotation.y += dt * 1.8;
      }

      const groundY = groundYAt ? groundYAt(obs.x, obs.z) : 0;
      const bob = obs.type === 'heart' ? Math.sin(obs.animTime * 3.2 + obs.phase) * 0.12 : 0;
      const jumpLift = (obs.type === 'npc' || obs.type === 'dog' || obs.type === 'bear') && obs.jumpTimer > 0
        ? Math.sin((1 - obs.jumpTimer / Math.max(obs.jumpDuration, 0.001)) * Math.PI) * obs.jumpHeight
        : 0;
      obs.mesh.position.set(obs.x, groundY + obs.visualYOffset + bob + jumpLift, obs.z);
      obs.mesh.visible = Math.abs(obs.z - playerZ) <= cullRadius;
    }

    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx < currentChunk - 3) {
        this.scene.remove(chunk.group);
        disposeGroup(chunk.group);
        for (const obs of chunk.obstacles) {
          const i = this.active.indexOf(obs);
          if (i !== -1) this.active.splice(i, 1);
        }
        this.chunks.delete(idx);
      }
    }
  }

  getObstaclesNear(z, radius = 30) {
    return this.active.filter(o => !o.dead && Math.abs(o.z - z) < radius);
  }

  getAvoidanceBlockers(z, radius = 90) {
    return this.active.filter(o =>
      !o.dead &&
      SOLID_OBSTACLE_TYPES.has(o.type) &&
      Math.abs(o.z - z) < radius
    );
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
