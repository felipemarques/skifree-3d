// @ts-nocheck
import * as THREE from 'three';

function rememberRest(obj) {
  obj.userData.restPosition = obj.position.clone();
  obj.userData.restRotation = obj.rotation.clone();
  return obj;
}

function resetPart(obj) {
  if (!obj?.userData?.restPosition || !obj?.userData?.restRotation) return;
  obj.position.copy(obj.userData.restPosition);
  obj.rotation.copy(obj.userData.restRotation);
}

function buildYetiMesh() {
  const group = new THREE.Group();
  const parts = {
    arms: [],
    legs: [],
    eyes: [],
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xddddee, roughness: 0.85, metalness: 0.0 });

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.45, 0.5, 1.1, 7);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);
  parts.body = rememberRest(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.38, 7, 6);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 1.75;
  head.castShadow = true;
  group.add(head);
  parts.head = rememberRest(head);

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
  for (let s = -1; s <= 1; s += 2) {
    const eyeGeo = new THREE.SphereGeometry(0.07, 4, 4);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.14, 1.82, 0.31);
    group.add(eye);
    eye.userData.side = s;
    parts.eyes.push(rememberRest(eye));
  }

  // Arms
  const armMat = new THREE.MeshStandardMaterial({ color: 0xccccdd, roughness: 0.85, metalness: 0.0 });
  for (let s = -1; s <= 1; s += 2) {
    const armGeo = new THREE.CylinderGeometry(0.14, 0.1, 0.85, 5);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(s * 0.65, 1.0, 0);
    arm.rotation.z = s * 0.8;
    arm.castShadow = true;
    group.add(arm);
    arm.userData.side = s;
    parts.arms.push(rememberRest(arm));
  }

  // Legs
  for (let s = -1; s <= 1; s += 2) {
    const legGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.65, 5);
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(s * 0.22, 0.32, 0);
    leg.castShadow = true;
    group.add(leg);
    leg.userData.side = s;
    parts.legs.push(rememberRest(leg));
  }

  group.userData.yetiParts = parts;
  return group;
}

function animateYeti(mesh, phase) {
  const parts = mesh.userData.yetiParts;
  if (!parts) return;

  for (const part of [parts.body, parts.head, ...parts.eyes, ...parts.arms, ...parts.legs]) {
    resetPart(part);
  }

  const stride = Math.sin(phase);
  const counter = Math.cos(phase);
  const bob = Math.abs(stride) * 0.08;

  if (parts.body) {
    parts.body.position.y += bob;
    parts.body.rotation.x += -0.12 + counter * 0.06;
    parts.body.rotation.z += stride * 0.05;
  }

  if (parts.head) {
    parts.head.position.y += bob + Math.sin(phase * 1.3) * 0.035;
    parts.head.rotation.x += Math.cos(phase * 0.8) * 0.05;
    parts.head.rotation.z += stride * 0.04;
  }

  for (const eye of parts.eyes) {
    eye.position.y += bob + Math.sin(phase * 1.3) * 0.035;
  }

  for (const arm of parts.arms) {
    const side = arm.userData.side || 1;
    arm.position.y += bob * 0.5;
    arm.rotation.x += Math.sin(phase + (side > 0 ? Math.PI : 0)) * 0.45;
    arm.rotation.z += side * (0.14 + Math.abs(stride) * 0.12);
  }

  for (const leg of parts.legs) {
    const side = leg.userData.side || 1;
    leg.position.y += Math.max(0, Math.sin(phase + (side > 0 ? 0 : Math.PI))) * 0.05;
    leg.rotation.x += Math.sin(phase + (side > 0 ? 0 : Math.PI)) * 0.28;
  }
}

const YETI_CAPTURE_DIST = 1.5;
const YETI_HALF_W = 0.75;
const YETI_HALF_D = 0.75;
const YETI_JUMPABLE_TYPES = new Set(['hole', 'fallen_tree', 'stump', 'rock']);
// baseSpeed must stay below the player's absolute max speed (BOOST_SPEED =
// 28, see Player.ts/shared/AuthoritativeSim.ts) or the yeti is guaranteed to
// catch up no matter how the player plays - extreme was previously 29,
// literally faster than the player can ever go, making it inescapable.
const DIFFICULTY_PRESETS = {
  easy: {
    triggerDistance: 2600,
    baseSpeed: 19,
    multiplyInterval: 12,
    maxYetis: 3,
  },
  normal: {
    triggerDistance: 2000,
    baseSpeed: 22,
    multiplyInterval: 8,
    maxYetis: 5,
  },
  hard: {
    triggerDistance: 1400,
    baseSpeed: 24,
    multiplyInterval: 5.5,
    maxYetis: 7,
  },
  extreme: {
    triggerDistance: 850,
    baseSpeed: 26,
    multiplyInterval: 3.8,
    maxYetis: 9,
  },
};

function collidesAABB(ax, az, ahw, ahd, b, padding = 0) {
  return (
    Math.abs(ax - b.x) < (ahw + b.halfW + padding) &&
    Math.abs(az - b.z) < (ahd + b.halfD + padding)
  );
}

function findBlockingObstacle(x, z, blockers, padding = 0.55) {
  if (!blockers) return null;
  for (const blocker of blockers) {
    if (blocker.dead) continue;
    if (collidesAABB(x, z, YETI_HALF_W, YETI_HALF_D, blocker, padding)) return blocker;
  }
  return null;
}

function steerAroundBlocker(dir, pos, blocker, phase) {
  if (!blocker) return dir;
  const side = Math.abs(pos.x - blocker.x) > 0.1
    ? (pos.x < blocker.x ? -1 : 1)
    : (phase % 2 > 1 ? -1 : 1);

  dir.x += side * 0.95;
  dir.z *= 0.55;
  if (dir.lengthSq() > 0.0001) dir.normalize();
  return dir;
}

export class YetiManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.yetis = [];
    this.active = false;
    this._timeSinceMultiply = 0;
    this._onCapture = null;
    this.startMode = ['distance', 'immediate', 'disabled'].includes(options.startMode)
      ? options.startMode
      : 'distance';
    this.setDifficulty(options.difficulty || 'normal');
  }

  setDifficulty(difficulty) {
    this.difficulty = DIFFICULTY_PRESETS[difficulty] ? difficulty : 'normal';
    this.config = DIFFICULTY_PRESETS[this.difficulty];
  }

  onCapture(cb) {
    this._onCapture = cb;
  }

  update(dt, playerPos, playerDistance, groundYAt = null, blockers = null) {
    if (this.startMode === 'disabled') {
      if (this.active || this.yetis.length) this.dispose();
      return;
    }

    // Trigger if player has skied far enough
    const shouldStartImmediately = this.startMode === 'immediate' && playerDistance >= 0;
    if (!this.active && (shouldStartImmediately || playerDistance >= this.config.triggerDistance)) {
      this.active = true;
      this._spawnYeti(playerPos, shouldStartImmediately ? 'behind' : 'left');
    }

    if (!this.active) return;

    // Multiply
    this._timeSinceMultiply += dt;
    if (this._timeSinceMultiply > this.config.multiplyInterval && this.yetis.length < this.config.maxYetis) {
      this._timeSinceMultiply = 0;
      const sides = ['left', 'right', 'behind'];
      const side = sides[Math.floor(Math.random() * sides.length)];
      this._spawnYeti(playerPos, side);
    }

    // Move each Yeti toward player
    for (const yeti of this.yetis) {
      if (yeti.captured) continue;
      if (yeti.jumpCooldown > 0) yeti.jumpCooldown = Math.max(0, yeti.jumpCooldown - dt);
      if (yeti.jumpTimer > 0) yeti.jumpTimer = Math.max(0, yeti.jumpTimer - dt);
      const airborne = yeti.jumpTimer > 0;

      const dir = new THREE.Vector3()
        .subVectors(playerPos, yeti.mesh.position);
      dir.y = 0;
      dir.normalize();
      const step = this.config.baseSpeed * dt;
      let nextX = yeti.mesh.position.x + dir.x * step;
      let nextZ = yeti.mesh.position.z + dir.z * step;
      const blocker = findBlockingObstacle(nextX, nextZ, blockers, 0.55);
      if (blocker && !airborne && YETI_JUMPABLE_TYPES.has(blocker.type) && yeti.jumpCooldown <= 0) {
        yeti.jumpDuration = 0.68;
        yeti.jumpTimer = yeti.jumpDuration;
        yeti.jumpHeight = blocker.type === 'hole' || blocker.type === 'fallen_tree' ? 0.82 : 0.56;
        yeti.jumpCooldown = 1.2;
      } else if (blocker && !airborne) {
        steerAroundBlocker(dir, yeti.mesh.position, blocker, yeti.phase);
        nextX = yeti.mesh.position.x + dir.x * step;
        nextZ = yeti.mesh.position.z + dir.z * step;
        if (findBlockingObstacle(nextX, nextZ, blockers, 0.25)) {
          nextX = yeti.mesh.position.x + dir.x * step * 0.35;
          nextZ = yeti.mesh.position.z + dir.z * step * 0.35;
        }
      }
      yeti.mesh.position.x = nextX;
      yeti.mesh.position.z = nextZ;
      const groundY = groundYAt ? groundYAt(yeti.mesh.position.x, yeti.mesh.position.z) : 0;
      yeti.mesh.position.y = groundY;

      // Face player
      yeti.mesh.lookAt(playerPos.x, groundY, playerPos.z);

      // Check capture
      const dist = yeti.mesh.position.distanceTo(playerPos);
      if (dist < YETI_CAPTURE_DIST) {
        yeti.captured = true;
        if (this._onCapture) this._onCapture();
      }
    }

    // Animate yetis (bob)
    const t = performance.now() * 0.004;
    for (const yeti of this.yetis) {
      const groundY = groundYAt ? groundYAt(yeti.mesh.position.x, yeti.mesh.position.z) : 0;
      const jumpLift = yeti.jumpTimer > 0
        ? Math.sin((1 - yeti.jumpTimer / Math.max(yeti.jumpDuration, 0.001)) * Math.PI) * yeti.jumpHeight
        : 0;
      yeti.mesh.position.y = groundY + Math.abs(Math.sin(t + yeti.phase)) * 0.25 + jumpLift;
      animateYeti(yeti.mesh, t * 1.8 + yeti.phase);
    }
  }

  _spawnYeti(nearPos, side) {
    const mesh = buildYetiMesh();
    let x, z;
    if (side === 'left')  { x = nearPos.x - 40; z = nearPos.z + 10; }
    if (side === 'right') { x = nearPos.x + 40; z = nearPos.z + 10; }
    if (side === 'behind'){ x = nearPos.x + (Math.random() - 0.5) * 30; z = nearPos.z - 30; }
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.yetis.push({
      mesh,
      captured: false,
      phase: Math.random() * Math.PI * 2,
      jumpTimer: 0,
      jumpDuration: 0,
      jumpHeight: 0,
      jumpCooldown: 0.6 + Math.random() * 0.8,
    });
  }

  isNearPlayer(playerPos) {
    return this.yetis.some(y => y.mesh.position.distanceTo(playerPos) < 35);
  }

  getThreats(playerPos, maxDistance = 140) {
    return this.yetis
      .filter(y => !y.captured)
      .map(y => {
        const dx = y.mesh.position.x - playerPos.x;
        const dz = y.mesh.position.z - playerPos.z;
        return {
          x: y.mesh.position.x,
          z: y.mesh.position.z,
          dx,
          dz,
          distance: Math.sqrt(dx * dx + dz * dz),
        };
      })
      .filter(threat => threat.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);
  }

  dispose() {
    for (const yeti of this.yetis) {
      this.scene.remove(yeti.mesh);
      yeti.mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    this.yetis = [];
    this.active = false;
  }
}
