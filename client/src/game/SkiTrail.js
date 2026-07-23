import * as THREE from 'three';

// ──────────────────────────────────────────────────────────────────────────
// SkiTrail
//
// Two visual effects:
//   1. SPRAY  — a pool of small snow-dust particles emitted from behind
//               each ski. Particles float upward, drift sideways, and fade.
//   2. GROOVES — thin flat quads left on the snow surface marking the ski
//               tracks. They are pooled (oldest reused) and stay in world
//               space so the trail persists as the player moves forward.
// ──────────────────────────────────────────────────────────────────────────

const SPRAY_COUNT   = 120;   // particle pool size (both skis combined)
const GROOVE_COUNT  = 200;   // max groove segments kept in the world
const EMIT_INTERVAL = 0.025; // seconds between spray emissions
const GROOVE_STEP   = 0.55;  // min distance moved before stamping a new groove

export class SkiTrail {
  constructor(scene) {
    this.scene = scene;

    // ── Spray particles ──────────────────────────────────────────────────
    this._sprayPositions = new Float32Array(SPRAY_COUNT * 3);
    this._sprayAlphas    = new Float32Array(SPRAY_COUNT);     // 0 = dead
    this._sprayVel       = [];   // per-particle {vx, vy, vz}
    this._sprayLife      = new Float32Array(SPRAY_COUNT);     // remaining life (s)
    this._sprayMaxLife   = new Float32Array(SPRAY_COUNT);

    for (let i = 0; i < SPRAY_COUNT; i++) {
      this._sprayAlphas[i] = 0;
      this._sprayLife[i]   = 0;
      this._sprayVel.push({ vx: 0, vy: 0, vz: 0 });
    }

    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute('position', new THREE.BufferAttribute(this._sprayPositions, 3));
    sprayGeo.setAttribute('alpha',    new THREE.BufferAttribute(this._sprayAlphas,    1));

    // Custom ShaderMaterial so each particle can have its own alpha
    const sprayMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */`
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(280.0 / -mvPos.z, 1.5, 12.0);
          gl_Position  = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = (1.0 - d * d) * vAlpha;
          // Pure white — bright enough to trigger bloom threshold
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
    });

    this._sprayPoints = new THREE.Points(sprayGeo, sprayMat);
    this._sprayPoints.frustumCulled = false;
    scene.add(this._sprayPoints);

    this._sprayIndex  = 0;   // next pool slot to use
    this._emitTimer   = 0;

    // ── Groove marks ─────────────────────────────────────────────────────
    // Each groove = a thin BoxGeometry quad stamped on the ground.
    // We pool them so GPU geometry count stays constant.
    this._grooves    = [];
    this._grooveIdx  = 0;
    this._lastGroovePos = new THREE.Vector3(0, 0, -9999);

    const grooveMat = new THREE.MeshBasicMaterial({
      color:       0xc0d8f0,
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
    });

    // Pre-create pooled groove meshes (just 2 tiny quads per stamp: left + right ski)
    // We create GROOVE_COUNT stamps × 2 skis = GROOVE_COUNT * 2 meshes total.
    // To keep draw-calls low, we batch into one InstancedMesh.
    const grooveGeo = new THREE.PlaneGeometry(0.08, GROOVE_STEP * 1.15);
    this._grooveInstanced = new THREE.InstancedMesh(grooveGeo, grooveMat, GROOVE_COUNT * 2);
    this._grooveInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._grooveInstanced.frustumCulled = false;
    // Start all instances invisible (scale to 0)
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < GROOVE_COUNT * 2; i++) {
      this._grooveInstanced.setMatrixAt(i, dummy.matrix);
    }
    this._grooveInstanced.instanceMatrix.needsUpdate = true;
    scene.add(this._grooveInstanced);

    this._dummy = new THREE.Object3D();
  }

  // ── Called every frame ────────────────────────────────────────────────
  update(dt, playerPos, playerAngle, playerSpeed, isAirborne, groundYAt = null) {
    this._updateSpray(dt, playerPos, playerAngle, playerSpeed, isAirborne, groundYAt);
    this._updateGrooves(playerPos, playerAngle, isAirborne, groundYAt);
  }

  // ── Spray ─────────────────────────────────────────────────────────────
  _updateSpray(dt, playerPos, playerAngle, playerSpeed, isAirborne, groundYAt) {
    const pos   = this._sprayPositions;
    const alpha = this._sprayAlphas;
    const vel   = this._sprayVel;
    const life  = this._sprayLife;
    const maxL  = this._sprayMaxLife;

    // Tick existing particles
    for (let i = 0; i < SPRAY_COUNT; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; continue; }

      pos[i * 3]     += vel[i].vx * dt;
      pos[i * 3 + 1] += vel[i].vy * dt;
      pos[i * 3 + 2] += vel[i].vz * dt;
      vel[i].vy      -= 3.5 * dt;          // light gravity

      alpha[i] = (life[i] / maxL[i]) * 0.85;
    }

    // Emit new particles when moving and not airborne
    if (!isAirborne && playerSpeed > 2) {
      this._emitTimer -= dt;
      if (this._emitTimer <= 0) {
        this._emitTimer = EMIT_INTERVAL * (1 + Math.random() * 0.4);

        // Lateral speed (turn intensity) amplifies spray amount+spread
        const turnIntensity = Math.abs(playerAngle) / (Math.PI * 0.42); // 0..1
        const sprayCount    = 1 + Math.floor(turnIntensity * 3);        // 1..4 per emit

        for (let k = 0; k < sprayCount; k++) {
          // Ski offset: both left and right ski
          for (const skiSide of [-1, 1]) {
            this._emitParticle(playerPos, playerAngle, playerSpeed, turnIntensity, skiSide, groundYAt);
          }
        }
      }
    }

    this._sprayPoints.geometry.attributes.position.needsUpdate = true;
    this._sprayPoints.geometry.attributes.alpha.needsUpdate    = true;
  }

  _emitParticle(playerPos, playerAngle, playerSpeed, turnIntensity, skiSide, groundYAt) {
    const i = this._sprayIndex % SPRAY_COUNT;
    this._sprayIndex++;

    const sinA = Math.sin(-playerAngle);
    const cosA = Math.cos(-playerAngle);

    // Start position: behind + to the side of the ski
    const bx = sinA *  0.6;   // slightly behind
    const bz = cosA * -0.6;
    const sx = cosA * skiSide * 0.14;   // lateral offset per ski
    const sz = sinA * skiSide * 0.14;

    const x = playerPos.x + bx + sx + (Math.random() - 0.5) * 0.12;
    const z = playerPos.z + bz + sz + (Math.random() - 0.5) * 0.12;
    const groundY = groundYAt ? groundYAt(x, z) : 0;

    this._sprayPositions[i * 3] = x;
    this._sprayPositions[i * 3 + 1] = groundY + playerPos.y + 0.06 + Math.random() * 0.08;
    this._sprayPositions[i * 3 + 2] = z;

    // Velocity: kick backward + lateral spray when turning (like a real ski edge)
    const baseVel     = playerSpeed * 0.18;
    const lateralKick = turnIntensity * playerSpeed * 0.22 * skiSide;

    this._sprayVel[i].vx = -sinA * baseVel + cosA * lateralKick + (Math.random() - 0.5) * 1.2;
    this._sprayVel[i].vy = 0.8 + Math.random() * 1.4 + turnIntensity * 1.0;
    this._sprayVel[i].vz = -cosA * baseVel + sinA * lateralKick + (Math.random() - 0.5) * 1.2;

    const life = 0.35 + Math.random() * 0.4 + turnIntensity * 0.3;
    this._sprayLife[i]    = life;
    this._sprayMaxLife[i] = life;
    this._sprayAlphas[i]  = 0.8;
  }

  // ── Grooves ───────────────────────────────────────────────────────────
  _updateGrooves(playerPos, playerAngle, isAirborne, groundYAt) {
    if (isAirborne) return;

    const dist = playerPos.distanceTo(this._lastGroovePos);
    if (dist < GROOVE_STEP) return;

    this._lastGroovePos.copy(playerPos);
    const dummy = this._dummy;

    // Stamp two grooves (left + right ski)
    for (let s = 0; s < 2; s++) {
      const side  = s === 0 ? -1 : 1;
      const slotL = ((this._grooveIdx * 2) + s) % (GROOVE_COUNT * 2);

      // Ski lateral offset in world space
      const cosA = Math.cos(-playerAngle);
      const sinA = Math.sin(-playerAngle);
      const ox   =  cosA * side * 0.14;
      const oz   =  sinA * side * 0.14;

      const x = playerPos.x + ox;
      const z = playerPos.z + oz;
      const groundY = groundYAt ? groundYAt(x, z) : 0;

      dummy.position.set(x, groundY + 0.012, z);
      dummy.rotation.set(-Math.PI / 2, 0, playerAngle);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this._grooveInstanced.setMatrixAt(slotL, dummy.matrix);
    }

    this._grooveIdx++;
    this._grooveInstanced.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this._sprayPoints);
    this._sprayPoints.geometry.dispose();
    this._sprayPoints.material.dispose();

    this.scene.remove(this._grooveInstanced);
    this._grooveInstanced.geometry.dispose();
    this._grooveInstanced.material.dispose();
  }
}
