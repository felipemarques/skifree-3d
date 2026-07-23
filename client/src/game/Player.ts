// @ts-nocheck
import * as THREE from 'three';
import { settings } from '../utils/Settings';
import { buildSkierMesh, updateSkierAnimation } from './SkierModel';

const MAX_HP = 3;
const BASE_SPEED = 14;
const BOOST_SPEED = 28;
const MIN_SPEED = BASE_SPEED * 0.22;
const MANUAL_JUMP_VELOCITY = 7.2;
const RAMP_JUMP_MIN_VELOCITY = 4.8;
const RAMP_JUMP_MAX_VELOCITY = 9.6;
const GRAVITY = 18;
const INVINCIBILITY_TIME = 1.8;
const HIT_BLINK_RATE = 0.08;
const UNSTUCK_PUSH = 5.0;
const STUCK_DETECT_TIME = 2.2;
const STUCK_Z_THRESHOLD = 0.8;
const DEATH_ANIMATION_DURATION = 1.75;
const YETI_CAPTURE_ANIMATION_DURATION = 2.15;
const DEATH_GROUND_CLEARANCE = 0.055;

function getDeathKindFromObstacle(type) {
  if (type === 'hole') return 'hole';
  if (type === 'tree') return 'tree';
  if (type === 'rock' || type === 'fallen_tree') return 'tumble';
  if (type === 'npc') return 'skier';
  return 'generic';
}

function collectSkierFragments(mesh) {
  const parts = mesh?.userData?.skierParts;
  if (!parts) return [];

  return [
    parts.body,
    parts.chest,
    parts.head,
    parts.helmet,
    parts.goggles,
    parts.scarf,
    parts.scarfTail,
    ...parts.arms,
    ...parts.hands,
    ...parts.legs,
    ...parts.skis,
    ...parts.poles,
  ].filter(Boolean);
}

function collectTumbleFragments(mesh) {
  const parts = mesh?.userData?.skierParts;
  if (!parts) return [];
  return [
    parts.helmet,
    parts.goggles,
    parts.scarf,
    parts.scarfTail,
    ...parts.skis,
    ...parts.poles,
  ].filter(Boolean);
}

function clampDeathY(y, groundY, clearance = DEATH_GROUND_CLEARANCE) {
  return Math.max(groundY + clearance, y);
}

export class Player {
  constructor(scene, color = 0x2979ff, name = 'Skier') {
    this.scene = scene;

    this.mesh = buildSkierMesh(color, {
      helmetColor: 0xff1744,
      scarfColor: 0xffd54f,
      name,
    });
    this.mesh.position.set(0, 0, 0);
    scene.add(this.mesh);

    this.position = new THREE.Vector3(0, 0, 0);
    this.angle = 0;
    this.speed = BASE_SPEED;
    this.isAlive = true;
    this.isAirborne = false;
    this.airTime = 0;
    this.jumpVelocityY = 0;
    this._airVelocityX = 0;
    this._airVelocityZ = 0;
    this._airAngle = 0;
    this._airborneFromRamp = false;

    this.halfW = 0.35;
    this.halfD = 0.55;

    this.hp = MAX_HP;
    this._invTimer = 0;
    this._blinkTimer = 0;
    this._isInvincible = false;

    this._leanTarget = 0;
    this._lean = 0;
    this._jumpHeld = false;
    this._holeFallTimer = 0;
    this._holeFallDuration = 0.42;
    this._deathAnimation = null;

    this._stuckTimer = 0;
    this._lastZ = 0;
    this._unstucking = false;
    this._unstuckTimer = 0;

    this.onHit = null;
    this.onDie = null;
    this.onJumpLand = null;
    this.onJumpStart = null;
    this.onUnstuck = null;
    this.onHeal = null;
  }

  get x() { return this.position.x; }
  get z() { return this.position.z; }
  get invincibilityRemaining() { return Math.max(0, this._invTimer); }

  grantInvincibility(seconds = INVINCIBILITY_TIME) {
    if (!this.isAlive) return;
    this._isInvincible = true;
    this._invTimer = Math.max(this._invTimer, Number(seconds) || 0);
    this._blinkTimer = HIT_BLINK_RATE;
    this._setCharacterVisible(true);
  }

  _setCharacterVisible(visible) {
    this.mesh.visible = true;
    this.mesh.traverse(obj => {
      if (obj.userData?.isNameLabel) {
        obj.visible = true;
      } else if (obj !== this.mesh) {
        obj.visible = visible;
      }
    });
  }

  unstuck() {
    if (!this.isAlive) return;

    this.position.z += UNSTUCK_PUSH;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -50, 50);
    this.position.y = 0;
    this.angle = 0;
    this.speed = BASE_SPEED;
    this.isAirborne = false;
    this.jumpVelocityY = 0;
    this._airVelocityX = 0;
    this._airVelocityZ = 0;
    this._airAngle = 0;
    this._airborneFromRamp = false;
    this.airTime = 0;
    this._holeFallTimer = 0;
    this._stuckTimer = 0;
    this._lastZ = this.position.z;

    this._unstucking = true;
    this._unstuckTimer = 0;

    if (this.onUnstuck) this.onUnstuck();
  }

  update(dt, input, obstacles) {
    if (!this.isAlive) {
      this.updateDeathAnimation(dt);
      return;
    }

    if (this._isInvincible) {
      this._invTimer -= dt;
      this._blinkTimer -= dt;
      if (this._blinkTimer <= 0) {
        this._blinkTimer = HIT_BLINK_RATE;
        const label = this.mesh.userData.nameLabel;
        this._setCharacterVisible(!(this.mesh.children.some(obj => obj !== label && obj.visible)));
      }
      if (this._invTimer <= 0) {
        this._isInvincible = false;
        this._setCharacterVisible(true);
      }
    }

    const steer = this.isAirborne ? 0 : input.lateralAxis;
    if (!this.isAirborne) {
      const turnSpeed = settings.get('keyTurnSpeed');
      this.angle = THREE.MathUtils.clamp(
        this.angle + steer * turnSpeed * dt,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );

      let targetSpeed = BASE_SPEED;
      const msf = input.mouseSpeedFraction;
      if (msf !== null) {
        targetSpeed = THREE.MathUtils.lerp(MIN_SPEED, BOOST_SPEED, msf);
      } else {
        if (input.boost) targetSpeed = BOOST_SPEED;
        if (input.brake) targetSpeed = MIN_SPEED;
      }

      const lateralFactor = Math.cos(this.angle);
      const penalisedTarget = targetSpeed * Math.max(lateralFactor, 0.28);
      this.speed = THREE.MathUtils.lerp(this.speed, penalisedTarget, Math.min(1, 10 * dt));
    }

    const jumpPressed = input.jump;
    if (jumpPressed && !this._jumpHeld) {
      this._triggerJump();
    }
    this._jumpHeld = jumpPressed;

    const moveX = this.isAirborne ? this._airVelocityX : Math.sin(this.angle) * this.speed;
    const moveZ = this.isAirborne ? this._airVelocityZ : Math.cos(this.angle) * this.speed;

    let newX = THREE.MathUtils.clamp(this.position.x + moveX * dt, -55, 55);
    let newZ = this.position.z + moveZ * dt;

    let hitSomething = false;
    let hitContext = null;
    for (const obs of obstacles) {
      if (obs.dead) continue;

      if (obs.type === 'ramp') {
        if (!this.isAirborne && this._collidesAABB(newX, newZ, obs)) {
          this._triggerJump(this._getRampJumpVelocity(), 'ramp');
        }
        continue;
      }

      if (obs.type === 'heart') {
        if (this._collidesAABB(newX, newZ, obs)) {
          obs.dead = true;
          obs.mesh.visible = false;
          if (this.hp < MAX_HP) {
            this.hp = Math.min(MAX_HP, this.hp + 1);
            if (this.onHeal) this.onHeal(this.hp);
          }
        }
        continue;
      }

      if (this.isAirborne && obs.type === 'tree' && !this._airborneFromRamp) {
        if (this._collidesAABB(newX, newZ, obs)) {
          const resolved = this._resolveCollision(newX, newZ, obs);
          newX = resolved.x;
          newZ = resolved.z;
          const impactSpeed = Math.hypot(this._airVelocityX, this._airVelocityZ);
          this._airVelocityX *= 0.18;
          this._airVelocityZ *= 0.18;
          this.jumpVelocityY = Math.min(this.jumpVelocityY, 0.5);
          this.speed *= 0.35;
          hitSomething = true;
          hitContext = { type: obs.type, obstacle: obs, impactSpeed };
        }
        continue;
      }

      if (this.isAirborne) continue;

      if (obs.type === 'hole') {
        if (this._collidesAABB(newX, newZ, obs)) {
          obs.dead = true;
          this._holeFallTimer = this._holeFallDuration;
          const impactSpeed = this.speed;
          this.speed *= 0.18;
          hitSomething = true;
          hitContext = { type: obs.type, obstacle: obs, impactSpeed };
        }
        continue;
      }

      if (this._collidesAABB(newX, newZ, obs)) {
        const resolved = this._resolveCollision(newX, newZ, obs);
        newX = resolved.x;
        newZ = resolved.z;

        const impactSpeed = this.speed;
        this.speed *= 0.35;
        hitSomething = true;
        hitContext = { type: obs.type, obstacle: obs, impactSpeed };
      }
    }

    if (hitSomething && !this._isInvincible) {
      this.hp = Math.max(0, this.hp - 1);

      if (this.hp <= 0) {
        this.isAlive = false;
        if (this.onDie) this.onDie({
          kind: getDeathKindFromObstacle(hitContext?.type),
          obstacleType: hitContext?.type || 'unknown',
          obstacle: hitContext?.obstacle || null,
          impactSpeed: hitContext?.impactSpeed || this.speed,
        });
      } else {
        this.grantInvincibility(INVINCIBILITY_TIME);
        if (this.onHit) this.onHit(this.hp);
      }
    }

    this.position.x = newX;
    this.position.z = newZ;

    if (this.isAirborne) {
      this.airTime += dt;
      this.position.y += this.jumpVelocityY * dt;
      this.jumpVelocityY -= GRAVITY * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        const landed = this.airTime;
        this.isAirborne = false;
        this.airTime = 0;
        this.jumpVelocityY = 0;
        this._airVelocityX = 0;
        this._airVelocityZ = 0;
        this._airborneFromRamp = false;
        if (this.onJumpLand) this.onJumpLand(landed);
      }
    }

    if (this._holeFallTimer > 0) {
      this._holeFallTimer = Math.max(0, this._holeFallTimer - dt);
    }

    const zDelta = Math.abs(this.position.z - this._lastZ);
    this._lastZ = this.position.z;

    if (zDelta / Math.max(dt, 0.001) < STUCK_Z_THRESHOLD) {
      this._stuckTimer += dt;
      if (this._stuckTimer >= STUCK_DETECT_TIME) this.unstuck();
    } else {
      this._stuckTimer = 0;
    }

    if (this._unstucking && !this._isInvincible) {
      this._unstuckTimer += dt;
      this._setCharacterVisible(Math.floor(this._unstuckTimer / 0.08) % 2 === 0);
      if (this._unstuckTimer > 1.0) {
        this._unstucking = false;
        this._setCharacterVisible(true);
      }
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = -this.angle;
    this.mesh.rotation.x = 0;

    if (this._holeFallTimer > 0) {
      const phase = 1 - this._holeFallTimer / this._holeFallDuration;
      const fall = Math.sin(phase * Math.PI);
      this.mesh.position.y = Math.max(0.035, this.mesh.position.y - fall * 0.06);
      this.mesh.rotation.x = -fall * 0.22;
      this.mesh.scale.set(1 - fall * 0.08, 1 - fall * 0.18, 1 - fall * 0.08);
    } else {
      this.mesh.scale.setScalar(1);
    }

    this._leanTarget = -steer * 0.3;
    this._lean = THREE.MathUtils.lerp(this._lean, this._leanTarget, 8 * dt);
    this.mesh.rotation.z = this._lean;

    updateSkierAnimation(this.mesh, {
      dt,
      speed: this.speed,
      steer,
      airborne: this.isAirborne,
      airTime: this.airTime,
    });
  }

  updateDeathAnimation(dt, groundYAt = null) {
    if (!this._deathAnimation) return;

    const anim = this._deathAnimation;
    anim.elapsed = Math.min(anim.duration, anim.elapsed + dt);
    const t = anim.elapsed / anim.duration;
    const ease = t * t * (3 - 2 * t);
    const groundY = groundYAt ? groundYAt(this.position.x, this.position.z) : 0;

    this._setCharacterVisible(true);

    if (anim.kind === 'yeti') {
      let burst = 0;

      if (anim.yetiVariant === 1) {
        const windup = THREE.MathUtils.clamp(t / 0.24, 0, 1);
        const throwT = THREE.MathUtils.clamp((t - 0.18) / 0.72, 0, 1);
        const arc = Math.sin(throwT * Math.PI);
        burst = THREE.MathUtils.clamp((t - 0.48) / 0.42, 0, 1);
        this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x + anim.side * 5.2, throwT);
        this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z + 2.8, throwT);
        this.position.y = clampDeathY(
          groundY + windup * 0.5 + arc * 2.4 - Math.max(0, throwT - 0.78) * 3.2,
          groundY,
        );
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = anim.startAngle + anim.side * throwT * Math.PI * 2.8;
        this.mesh.rotation.x = -throwT * Math.PI * 2.2;
        this.mesh.rotation.z = anim.side * throwT * Math.PI * 3.2;
      } else if (anim.yetiVariant === 2) {
        const liftT = THREE.MathUtils.clamp(t / 0.34, 0, 1);
        const slamT = THREE.MathUtils.clamp((t - 0.28) / 0.3, 0, 1);
        const settle = THREE.MathUtils.clamp((t - 0.58) / 0.26, 0, 1);
        burst = THREE.MathUtils.clamp((t - 0.5) / 0.38, 0, 1);
        this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x - anim.side * 0.55, settle);
        this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z + 0.42, settle);
        this.position.y = clampDeathY(groundY + Math.sin(liftT * Math.PI) * 1.65 - slamT * 0.52, groundY, 0.28);
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = anim.startAngle + anim.side * Math.sin(t * Math.PI * 2) * 0.55;
        this.mesh.rotation.x = -Math.PI * 0.5 - slamT * Math.PI * 0.34;
        this.mesh.rotation.z = anim.side * (liftT * Math.PI * 0.38 + settle * Math.PI * 0.9);
      } else {
        const launch = Math.sin(Math.min(1, t / 0.58) * Math.PI * 0.5);
        const fall = THREE.MathUtils.clamp((t - 0.72) / 0.28, 0, 1);
        burst = THREE.MathUtils.clamp((t - 0.38) / 0.62, 0, 1);
        this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x + anim.side * 0.85, ease);
        this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z + 0.7, ease);
        this.position.y = clampDeathY(groundY + launch * 4.2 - fall * fall * 1.7, groundY);
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = anim.startAngle + anim.side * ease * Math.PI * 1.2;
        this.mesh.rotation.x = -ease * Math.PI * 1.85;
        this.mesh.rotation.z = anim.side * ease * Math.PI * 1.5;
      }

      if (burst > 0) {
        for (const fragment of anim.fragments) {
          const swirl = anim.yetiVariant === 1
            ? new THREE.Vector3(
                Math.cos(fragment.spiralPhase + burst * Math.PI * 2.2) * fragment.swirlRadius,
                0,
                Math.sin(fragment.spiralPhase + burst * Math.PI * 2.2) * fragment.swirlRadius,
              )
            : new THREE.Vector3();
          const slamBoost = anim.yetiVariant === 2 ? 1.55 : 1;
          fragment.obj.position
            .copy(fragment.restPosition)
            .addScaledVector(fragment.velocity, burst * slamBoost)
            .addScaledVector(swirl, burst);
          fragment.obj.position.y += Math.sin(burst * Math.PI) * fragment.lift * (anim.yetiVariant === 2 ? 1.8 : 1);
          fragment.obj.rotation.x = fragment.restRotation.x + fragment.spin.x * burst * slamBoost;
          fragment.obj.rotation.y = fragment.restRotation.y + fragment.spin.y * burst * slamBoost;
          fragment.obj.rotation.z = fragment.restRotation.z + fragment.spin.z * burst * slamBoost;
        }
      }
      return;
    }

    if (anim.kind === 'hole') {
      const drop = Math.sin(t * Math.PI) * 0.18;
      const squash = THREE.MathUtils.lerp(1, 0.42, ease);
      this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.target.x, ease);
      this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.target.z, ease);
      this.position.y = clampDeathY(groundY + 0.08 - drop, groundY);
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = anim.startAngle + Math.sin(t * Math.PI) * 0.5;
      this.mesh.rotation.x = -ease * Math.PI * 0.62;
      this.mesh.rotation.z = Math.sin(t * Math.PI * 2.2) * 0.42 * (1 - t);
      this.mesh.scale.set(
        THREE.MathUtils.lerp(1, 0.76, ease),
        squash,
        THREE.MathUtils.lerp(1, 0.76, ease),
      );
      return;
    }

    if (anim.kind === 'tree') {
      const recoil = Math.sin(t * Math.PI) * 0.65;
      const gearBurst = THREE.MathUtils.clamp((t - 0.08) / 0.68, 0, 1);
      this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x + anim.side * 0.9, ease);
      this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z - 0.75, ease);
      this.position.y = clampDeathY(groundY + Math.sin(t * Math.PI) * 0.24, groundY, 0.28);
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = anim.startAngle + anim.side * recoil;
      this.mesh.rotation.x = -ease * Math.PI * 0.42;
      this.mesh.rotation.z = anim.side * ease * Math.PI * 0.72;
      if (gearBurst > 0) {
        for (const fragment of anim.tumbleFragments) {
          fragment.obj.position.copy(fragment.restPosition).addScaledVector(fragment.velocity, gearBurst * 0.75);
          fragment.obj.position.y += Math.sin(gearBurst * Math.PI) * fragment.lift * 0.8;
          fragment.obj.rotation.x = fragment.restRotation.x + fragment.spin.x * gearBurst * 0.7;
          fragment.obj.rotation.y = fragment.restRotation.y + fragment.spin.y * gearBurst * 0.7;
          fragment.obj.rotation.z = fragment.restRotation.z + fragment.spin.z * gearBurst * 0.7;
        }
      }
      return;
    }

    if (anim.kind === 'skier') {
      const roll = ease * Math.PI * 2.4;
      const gearBurst = THREE.MathUtils.clamp((t - 0.14) / 0.64, 0, 1);
      this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x + anim.side * 1.75, ease);
      this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z + 1.35, ease);
      this.position.y = clampDeathY(groundY + Math.sin(t * Math.PI) * 0.35, groundY, 0.28);
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = anim.startAngle + anim.side * 0.55;
      this.mesh.rotation.x = -Math.PI * 0.5 - roll * 0.18;
      this.mesh.rotation.z = anim.side * roll;

      if (anim.partnerMesh) {
        const partnerX = THREE.MathUtils.lerp(anim.partnerStart.x, anim.partnerStart.x - anim.side * 1.45, ease);
        const partnerZ = THREE.MathUtils.lerp(anim.partnerStart.z, anim.partnerStart.z + 1.0, ease);
        const partnerGroundY = groundYAt ? groundYAt(partnerX, partnerZ) : 0;
        anim.partnerMesh.position.set(
          partnerX,
          clampDeathY(partnerGroundY + Math.sin(t * Math.PI) * 0.28, partnerGroundY, 0.28),
          partnerZ,
        );
        anim.partnerMesh.rotation.y = anim.partnerStartRotation.y - anim.side * 0.7;
        anim.partnerMesh.rotation.x = -Math.PI * 0.5;
        anim.partnerMesh.rotation.z = -anim.side * ease * Math.PI * 1.6;
      }
      if (gearBurst > 0) {
        for (const fragment of anim.tumbleFragments) {
          fragment.obj.position.copy(fragment.restPosition).addScaledVector(fragment.velocity, gearBurst * 0.62);
          fragment.obj.position.y += Math.sin(gearBurst * Math.PI) * fragment.lift * 0.65;
          fragment.obj.rotation.x = fragment.restRotation.x + fragment.spin.x * gearBurst * 0.55;
          fragment.obj.rotation.y = fragment.restRotation.y + fragment.spin.y * gearBurst * 0.55;
          fragment.obj.rotation.z = fragment.restRotation.z + fragment.spin.z * gearBurst * 0.55;
        }
      }
      return;
    }

    const speed01 = THREE.MathUtils.clamp((anim.impactSpeed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1);
    const forwardSlide = THREE.MathUtils.lerp(2.1, 6.2, speed01);
    const sideSlide = THREE.MathUtils.lerp(0.7, 1.85, speed01);
    const rollTurns = THREE.MathUtils.lerp(3.2, 7.2, speed01);
    const bounce = Math.abs(Math.sin(t * Math.PI * (2.0 + speed01 * 1.4))) *
      THREE.MathUtils.lerp(0.24, 0.58, speed01) *
      (1 - t * 0.55);
    const skidShake = Math.sin(t * Math.PI * 10) * 0.08 * speed01 * (1 - t);

    this.position.x = THREE.MathUtils.lerp(anim.start.x, anim.start.x + anim.side * sideSlide, ease);
    this.position.z = THREE.MathUtils.lerp(anim.start.z, anim.start.z + forwardSlide, ease);
    this.position.y = clampDeathY(groundY + bounce, groundY, 0.28);
    this.mesh.position.copy(this.position);
    const roll = ease * Math.PI * rollTurns;
    this.mesh.rotation.y = anim.startAngle + anim.side * (0.35 + speed01 * 0.8) + skidShake;
    this.mesh.rotation.x = -roll;
    this.mesh.rotation.z = anim.side * roll * THREE.MathUtils.lerp(0.46, 0.72, speed01);

    const gearBurst = THREE.MathUtils.clamp((t - 0.12) / 0.72, 0, 1);
    if (gearBurst > 0) {
      for (const fragment of anim.tumbleFragments) {
        fragment.obj.position
          .copy(fragment.restPosition)
          .addScaledVector(fragment.velocity, gearBurst);
        fragment.obj.position.y += Math.sin(gearBurst * Math.PI) * fragment.lift;
        fragment.obj.rotation.x = fragment.restRotation.x + fragment.spin.x * gearBurst;
        fragment.obj.rotation.y = fragment.restRotation.y + fragment.spin.y * gearBurst;
        fragment.obj.rotation.z = fragment.restRotation.z + fragment.spin.z * gearBurst;
      }
    }
  }

  _collidesAABB(px, pz, obs) {
    return (
      Math.abs(px - obs.x) < (this.halfW + obs.halfW) &&
      Math.abs(pz - obs.z) < (this.halfD + obs.halfD)
    );
  }

  _resolveCollision(px, pz, obs) {
    const overlapX = (this.halfW + obs.halfW) - Math.abs(px - obs.x);
    const overlapZ = (this.halfD + obs.halfD) - Math.abs(pz - obs.z);

    if (overlapX < overlapZ) {
      const dir = Math.sign(px - obs.x) || 1;
      return {
        x: px + overlapX * dir,
        z: pz,
      };
    }

    const dir = Math.sign(pz - obs.z) || -1;
    return {
      x: px,
      z: pz + overlapZ * dir,
    };
  }

  collideWithSkier(partnerMesh, partnerState = {}) {
    if (!this.isAlive || this.isAirborne || this._isInvincible || this._holeFallTimer > 0 || !partnerMesh) {
      return false;
    }

    const dx = Math.abs(this.position.x - partnerMesh.position.x);
    const dz = Math.abs(this.position.z - partnerMesh.position.z);
    if (dx >= this.halfW + 0.38 || dz >= this.halfD + 0.58) return false;

    this.speed *= 0.35;
    this.position.x += (Math.sign(this.position.x - partnerMesh.position.x) || 1) * 0.45;
    this.hp = Math.max(0, this.hp - 1);

    if (this.hp <= 0) {
      this.isAlive = false;
      if (this.onDie) this.onDie({
        kind: 'skier',
        obstacleType: 'remote_player',
        partnerMesh,
        partnerState,
      });
    } else {
      this.grantInvincibility(INVINCIBILITY_TIME);
      if (this.onHit) this.onHit(this.hp);
    }

    return true;
  }

  takeCombatHit(context = {}) {
    if (!this.isAlive || this._isInvincible || this._holeFallTimer > 0) return false;

    const pushDir = Math.sign(this.position.x - Number(context.projectileX ?? this.position.x)) || 1;
    this.position.x = THREE.MathUtils.clamp(this.position.x + pushDir * 0.38, -55, 55);
    this.speed *= 0.58;
    this.hp = Math.max(0, this.hp - 1);

    if (this.hp <= 0) {
      this.isAlive = false;
      if (this.onDie) this.onDie({
        kind: context.kind || 'skier',
        obstacleType: context.obstacleType || 'combat_projectile',
        impactSpeed: context.impactSpeed || this.speed,
      });
    } else {
      this.grantInvincibility(INVINCIBILITY_TIME);
      if (this.onHit) this.onHit(this.hp);
    }

    return true;
  }

  _triggerJump(force = MANUAL_JUMP_VELOCITY, source = 'manual') {
    if (this.isAirborne || this._holeFallTimer > 0) return;

    this.isAirborne = true;
    this._airborneFromRamp = source === 'ramp';
    this.jumpVelocityY = force;
    this.airTime = 0;
    this._airAngle = this.angle;
    this._airVelocityX = Math.sin(this._airAngle) * this.speed;
    this._airVelocityZ = Math.cos(this._airAngle) * this.speed;
    if (this.onJumpStart) this.onJumpStart(source);
  }

  _getRampJumpVelocity() {
    const t = THREE.MathUtils.clamp((this.speed - MIN_SPEED) / (BOOST_SPEED - MIN_SPEED), 0, 1);
    const eased = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(RAMP_JUMP_MIN_VELOCITY, RAMP_JUMP_MAX_VELOCITY, eased);
  }

  startDeathAnimation(context = {}) {
    const obstacle = context.obstacle || null;
    const partnerMesh = context.partnerMesh || obstacle?.mesh || null;
    const partnerStart = partnerMesh ? partnerMesh.position.clone() : null;
    const partnerStartRotation = partnerMesh ? partnerMesh.rotation.clone() : null;
    const side = obstacle && Math.abs(this.position.x - obstacle.x) > 0.1
      ? Math.sign(this.position.x - obstacle.x)
      : (this.angle >= 0 ? 1 : -1);

    const kind = context.kind || 'generic';
    this.isAlive = false;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
    for (const fragment of collectSkierFragments(this.mesh)) {
      if (fragment.userData.restPosition) fragment.position.copy(fragment.userData.restPosition);
      if (fragment.userData.restRotation) fragment.rotation.copy(fragment.userData.restRotation);
    }
    this._deathAnimation = {
      kind,
      yetiVariant: kind === 'yeti'
        ? Math.max(0, Math.min(2, Math.floor(context.yetiVariant ?? Math.random() * 3)))
        : 0,
      duration: kind === 'yeti' ? YETI_CAPTURE_ANIMATION_DURATION : DEATH_ANIMATION_DURATION,
      elapsed: 0,
      impactSpeed: Number(context.impactSpeed) || this.speed || BASE_SPEED,
      start: this.position.clone(),
      target: obstacle
        ? new THREE.Vector3(obstacle.x ?? this.position.x, 0, obstacle.z ?? this.position.z)
        : this.position.clone(),
      startAngle: this.angle,
      side: side || 1,
      partnerMesh,
      partnerStart,
      partnerStartRotation,
      tumbleFragments: ['tumble', 'tree', 'skier'].includes(kind)
        ? collectTumbleFragments(this.mesh).map((obj, i) => {
            const sideBias = obj.userData.side || (i % 2 === 0 ? 1 : -1);
            const speed01 = THREE.MathUtils.clamp(((Number(context.impactSpeed) || this.speed) - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1);
            const base = 0.35 + speed01 * 0.95;
            return {
              obj,
              restPosition: obj.position.clone(),
              restRotation: obj.rotation.clone(),
              velocity: new THREE.Vector3(
                sideBias * base * (0.55 + (i % 3) * 0.22),
                base * (0.35 + (i % 4) * 0.13),
                base * (0.75 + (i % 5) * 0.18),
              ),
              lift: base * (0.28 + (i % 4) * 0.08),
              spin: new THREE.Vector3(
                sideBias * base * (3.2 + (i % 4) * 0.7),
                base * (2.4 + (i % 3) * 0.55),
                sideBias * base * (4.4 + (i % 5) * 0.6),
              ),
            };
          })
        : [],
      fragments: kind === 'yeti'
        ? collectSkierFragments(this.mesh).map((obj, i) => {
            const sideBias = obj.userData.side || (i % 2 === 0 ? 1 : -1);
            return {
              obj,
              restPosition: obj.position.clone(),
              restRotation: obj.rotation.clone(),
              velocity: new THREE.Vector3(
                sideBias * (0.22 + (i % 4) * 0.08),
                0.12 + (i % 5) * 0.045,
                ((i % 3) - 1) * 0.2 - 0.08,
              ),
              lift: 0.12 + (i % 4) * 0.035,
              spin: new THREE.Vector3(
                sideBias * (1.8 + (i % 3) * 0.55),
                (i % 2 === 0 ? 1 : -1) * (1.2 + (i % 5) * 0.35),
                sideBias * (2.2 + (i % 4) * 0.42),
              ),
              spiralPhase: i * 1.37,
              swirlRadius: 0.08 + (i % 5) * 0.045,
            };
          })
        : [],
    };
  }

  forceFatalCollision(context = {}) {
    if (!this.isAlive) return;
    this.hp = 0;
    this.isAlive = false;
    if (this.onDie) this.onDie(context);
  }

  getState() {
    return {
      x: this.position.x,
      z: this.position.z,
      y: this.position.y,
      angle: this.angle,
      speed: this.speed,
    };
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
