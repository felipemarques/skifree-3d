// @ts-nocheck
import * as THREE from 'three';

// The avalanche hazard (shared/AuthoritativeSim.ts's maybeApplyAvalancheCapture)
// is pure gap math with no real 3D position. Getting this to actually read
// as a threat took three fixes beyond "add some particles":
//  1. Position: the real gap is often 20-80 units, but the chase camera only
//     sits ~10 units behind the player, so anything placed at the literal
//     gap distance is behind the camera - permanently off screen. The cloud
//     is instead placed a few units behind the player (VISUAL_DIST_*,
//     compressed from dangerT), always inside the camera's view.
//  2. Rendering technique: gl.POINTS (THREE.Points) has its max on-screen
//     size clamped by the driver's ALIASED_POINT_SIZE_RANGE, which can be
//     tiny on software/low-end renderers (SwiftShader in particular) -
//     asking for a large `size` silently rendered as a faint speckle.
//     THREE.Sprite billboards size via real geometry (a scaled quad), so
//     there's no such clamp.
//  3. Softness: a soft radial-gradient sprite texture instead of a flat
//     square reads as a puff of snow instead of a grid of dots.
//  4. Height/radius: this close to the camera (a few units), even modest
//     spread subtends a huge angle - CLOUD_HEIGHT=12 put most particles
//     above the camera's framing, and CLOUD_RADIUS_X=22 pushed them out to
//     the screen edges/corners instead of clustering behind the player.
//     Both kept small and ground-hugging so it reads as one dense clump
//     directly behind you, not scattered wings at the periphery.
const PARTICLE_COUNT = 90;
const CLOUD_RADIUS_X = 9;
const CLOUD_HEIGHT = 3.2;
const CLOUD_DEPTH = 7;
// Camera sits ~10 units behind the player (GameCamera's offset.z=-10) - stay
// safely in front of it at every danger level instead of tracking the real
// (much larger) gap. Individually-huge sprites this close to the camera
// whited out the whole screen at PUFF_SIZE_MAX~8.5 - kept further back and
// smaller so it reads as a dense cloud, not a screen-filling wall.
const VISUAL_DIST_FAR = 9;
const VISUAL_DIST_NEAR = 4.5;
const PUFF_SIZE_MIN = 2.6;
const PUFF_SIZE_MAX = 5.8;

function makePuffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  // A cooler, darker mid/outer tone (rather than fading straight to white)
  // gives each puff visible shape/shading against light backgrounds -  a
  // flat white-on-white gradient has no contours once overlapped.
  gradient.addColorStop(0.45, 'rgba(196,203,212,0.85)');
  gradient.addColorStop(1, 'rgba(150,159,171,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function spawnParticle(state) {
  state.ox = (Math.random() - 0.5) * 2;
  state.oy = Math.random();
  state.oz = (Math.random() - 0.5) * 2;
  state.speed = 0.4 + Math.random() * 1.4;
  state.phase = Math.random() * Math.PI * 2;
  state.sizeJitter = 0.7 + Math.random() * 0.7;
}

export class AvalancheEffect {
  constructor(scene) {
    this.scene = scene;
    this._intensity = 0;
    this._texture = makePuffTexture();

    this.group = new THREE.Group();
    this._sprites = [];
    this._states = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const state = {};
      spawnParticle(state);
      this._states.push(state);
      const material = new THREE.SpriteMaterial({
        map: this._texture,
        // Pure white/pale gray blended into this game's hazy overcast
        // atmosphere almost perfectly (confirmed via a direct in-engine A/B
        // screenshot comparison) - a proper mid-gray keeps it in the "gray"
        // family while staying well clear of the ambient fog tone.
        color: 0x878e97,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(PUFF_SIZE_MIN);
      this._sprites.push(sprite);
      this.group.add(sprite);
    }
    this.group.frustumCulled = false;
    scene.add(this.group);
  }

  /**
   * anchorX/anchorZ: player's own world position (NOT the avalanche's real
   * implied position - see file comment on why literal distance is unusable).
   * groundY: rough terrain height to float the cloud just above.
   * dangerT: 0..1 proximity (same value the HUD danger meter uses) - drives
   * how close/large/opaque the cloud reads.
   * active: whether an avalanche zone is currently live at all - a zone
   * spans its whole length (AVALANCHE_ZONE_LENGTH), but a player who
   * sustains speed can push the real gap-based dangerT back down to 0 long
   * before physically reaching the end of it. No opacity floor here: the
   * cloud must be able to fade all the way to invisible (dangerT -> 0)
   * while still technically "active", or it reads as endlessly trailing
   * the player for the rest of the zone after the danger's already gone.
   */
  update(dt, anchorX, groundY, anchorZ, dangerT, active) {
    this._intensity += (THREE.MathUtils.clamp(dangerT, 0, 1) - this._intensity) * Math.min(1, dt * 3);
    const targetOpacity = active ? THREE.MathUtils.lerp(0, 0.95, this._intensity) : 0;
    const puffSize = THREE.MathUtils.lerp(PUFF_SIZE_MIN, PUFF_SIZE_MAX, this._intensity);

    const visualDist = THREE.MathUtils.lerp(VISUAL_DIST_FAR, VISUAL_DIST_NEAR, this._intensity);
    const spread = THREE.MathUtils.lerp(0.75, 1.2, this._intensity);
    const now = performance.now() * 0.001;

    // Only track the player while a zone is actually active. Once it isn't
    // (outrun or exited), the cloud must stop following and just fade out
    // where it was left - repositioning every frame during the fade (using
    // whatever anchor the caller still passes in, usually the player's
    // current position) made an already-despawning cloud look like it was
    // still chasing you the entire time it took to fade.
    if (active) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = this._states[i];
        const sprite = this._sprites[i];
        const churn = Math.sin(now * p.speed + p.phase) * 0.16;
        sprite.position.set(
          anchorX + (p.ox + churn) * CLOUD_RADIUS_X * spread,
          groundY + Math.abs(p.oy) * CLOUD_HEIGHT * spread * (0.35 + 0.65 * this._intensity),
          anchorZ - visualDist + p.oz * CLOUD_DEPTH * spread * 0.5,
        );
        sprite.scale.setScalar(puffSize * p.sizeJitter);
      }
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._sprites[i].material.opacity += (targetOpacity - this._sprites[i].material.opacity) * Math.min(1, dt * 4);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const sprite of this._sprites) sprite.material.dispose();
    this._texture.dispose();
  }
}
