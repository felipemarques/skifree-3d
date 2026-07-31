// @ts-nocheck
import * as THREE from 'three';
import { Terrain } from './Terrain';
import { SnowTerrain } from './SnowTerrain';
import { Player } from './Player';
import { RemotePlayer } from './RemotePlayer';
import { GhostPlayer } from './GhostPlayer';
import { Obstacles } from './Obstacles';
import { YetiManager } from './Yeti';
import { GameCamera } from './Camera';
import { SnowParticles } from './Snow';
import { Input } from './Input';
import { SeededRandom } from '../utils/SeededRandom';
import { AudioManager } from './AudioManager';
import { SkiTrail } from './SkiTrail';
import { ImpactParticles } from './ImpactParticles';
import { SkyBg } from './SkyBg';
import { HorizonMountains } from './HorizonMountains';
import { PostFX } from './PostFX';
import { CourseDecor } from './CourseDecor';
import { Wildlife } from './Wildlife';
import { Landmarks } from './Landmarks';
import { Aurora } from './Aurora';
import { StormWall } from './StormWall';
import { createBiomeBlendTarget, getBiomeAtZ, getDominantBiome } from './Biome';
import { settings } from '../utils/Settings';
import { getVisualTerrainY } from './VisualTerrain';
import {
  GRAVITY,
  SIM_DT,
  BASE_SPEED,
  DEFAULT_PLAYER_COLOR,
  PLAYER_TURN_RATE,
  PLAYER_MAX_TURN_ANGLE,
  createInitialPlayerState,
  createMultiplayerSpawnXs,
  getChainWindowMs,
  getGameplayObstaclesNear,
  getWeatherAtZ,
  getYetiConfig,
  sanitizePlayerColor,
  simulatePlayerTick,
  WEATHER_ZONE_LENGTH,
} from '../../../shared/AuthoritativeSim';

const CHUNK_SIZE = 80;
const MAX_HP = 3;
const GAME_OVER_SCREEN_DELAY_MS = 1850;
const YETI_GAME_OVER_SCREEN_DELAY_MS = 2250;
const SKY_MARIO_THROW_COOLDOWN = 0.75;
const PROJECTILE_LIFETIME = 2.4;
const PROJECTILE_SPEED = 34;
const MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS = 5;
const HITSTOP_TIME_SCALE = 0.05;
const YETI_DANGER_RADIUS = 16;
const YETI_PROXIMITY_BONUS_RATE = 3;
const GHOST_SAMPLE_INTERVAL_S = 0.12;
// How far ahead of an upcoming blizzard zone the StormWall visual starts
// fading in - see _updateStormWall.
const STORM_WALL_LOOKAHEAD = 280;
const STORM_WALL_MAX_OPACITY = 0.62;
// Multiplayer snapshot watchdog (M11). Snapshots stream at SNAPSHOT_HZ (30/s)
// over volatile emits, which the transport silently drops under congestion.
// A multi-second drought with a live socket means the server's truth is
// unreachable: the client would otherwise keep predicting from stale state
// forever and reveal a crash that happened seconds ago. Warn once, then hand
// the teardown to the controller (same path as a disconnect).
const SNAPSHOT_WARNING_MS = 2000;
const SNAPSHOT_TIMEOUT_MS = 5000;
// Legacy (non-authoritative) multiplayer broadcasts player state at this
// rate. Was referenced but never defined → `1 / undefined` = NaN, silently
// disabling the path (minor list).
const NET_UPDATE_HZ = 30;
// Predicted death reveal: a local crash is hidden as "possibly alive" until
// the next snapshot confirms it. If the snapshot is late (loss spike), that
// hide-until-confirm becomes "dead but still skiing for the whole outage".
// Reveal the predicted death locally after this short window instead; a
// snapshot that disagrees (wrong prediction) revives the player on arrival
// (minor list: RTT death reveal).
const PREDICTED_DEATH_REVEAL_MS = 40;
// Slow, one-directional time-of-day drift toward a warm "golden hour" tint,
// purely cosmetic - a full day/night cycle doesn't make sense for a run
// that's minutes long, but a long run slowly warming/dimming does. Capped
// well under 1 so biome identity (forest green, cliffs orange) never fully
// disappears under it.
const DAY_DRIFT_SECONDS = 900;
const DAY_DRIFT_MAX_STRENGTH = 0.55;
const GOLDEN_HOUR = {
  skyTop: new THREE.Color(0x3a2f52), skyHorizon: new THREE.Color(0xf2895a), skyGround: new THREE.Color(0xffd9a0),
  fogColor: new THREE.Color(0xf0a878), sunColor: new THREE.Color(0xffb066),
  hemiSky: new THREE.Color(0xf5c9a0), hemiGround: new THREE.Color(0x5a4560),
};
const DEV_REMOTE_HALF_W = 0.35;
const DEV_REMOTE_HALF_D = 0.55;
const DEV_HITBOX_COLORS = {
  player: 0x4dffb0,
  remote: 0xffe066,
  ramp: 0x4dd2ff,
  hole: 0xb37bff,
  heart: 0xff8fd0,
  npc: 0xffa94d,
  dog: 0xffa94d,
  bear: 0xff6b4d,
  tree: 0xff4d6d,
  rock: 0xff4d6d,
  stump: 0xff4d6d,
  fallen_tree: 0xff4d6d,
  default: 0xffffff,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function getFogDistances(useHighGraphics, fogLevel) {
  const level = clamp(Number(fogLevel ?? 1), 0, 2);
  const baseNear = useHighGraphics ? 100 : 68;
  const baseFar = useHighGraphics ? 260 : 158;
  const lighter = Math.max(0, 1 - level);
  const heavier = Math.max(0, level - 1);

  const near = baseNear + lighter * 78 - heavier * 32;
  const far = baseFar + lighter * 92 - heavier * 50;
  return { near: Math.max(30, near), far: Math.max(near + 80, far) };
}

// FogExp2's density has no explicit near/far, just a continuous falloff -
// derive a density from a target "far" distance so tuning stays in the
// same intuitive units as before, while getting exponential's more natural,
// genuinely volumetric-reading falloff (thin close up, thick further out,
// no hard linear ramp) instead of Fog's flat linear gradient. k=2.1 puts
// ~99% opacity right around the target far distance.
function fogDensityFromFar(far) {
  return 2.1 / Math.max(1, far);
}

function colorToNumber(color) {
  return parseInt(sanitizePlayerColor(color).slice(1), 16);
}

export class Game {
  constructor(renderer, ui, socketClient, options = {}) {
    this.renderer = renderer;
    this.ui = ui;
    this.socket = Object.prototype.hasOwnProperty.call(options, 'socket')
      ? options.socket
      : socketClient;
    this.options = options; // { seed, playerName, roomId, multiplayer }
    this.audio = new AudioManager(); // Initialize audio manager
    
    this._running = false;
    this._lastTime = 0;
    this._hitstopRemaining = 0;
    this._yetiDangerT = 0;
    this._yetiTriggerAtElapsedS = -1;
    this._chainRemainingT = 0;
    this._netTimer = 0;
    this._animFrame = null;
    this._scores = new Map();
    this._ghostRecording = !this.options.multiplayer ? { keyframes: [], sampleTimer: 0 } : null;
    this._pendingGhostSaved = false;
    this.dailyKey = this.options.dailyKey || null;
    this._gameOverSent = false;
    this._finalGameOverShown = false;
    this._gameOverDistance = 0;
    this._gameOverTime = 0;
    this._startTime = performance.now();
    this._elapsedSeconds = 0;
    this._boostHeld = false;
    this._fireHeld = false;
    this._throwCooldown = 0;
    this._yetiWasNear = false;
    this._lastWeatherKind = 'clear';
    this._spawnProtectionRemaining = this.options.multiplayer
      ? MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS
      : 0;
    this.gameMode = this.options.multiplayer
      ? (this.options.roomSettings?.gameMode || 'classic')
      : (this.options.gameMode || settings.get('gameMode') || 'classic');
    this.graphicsQuality = settings.get('graphicsQuality');
    this.fogLevel = settings.get('fogLevel');
    this.snowVolume = settings.get('snowVolume');
    this.roomSettings = this.options.multiplayer ? (this.options.roomSettings || {}) : {};
    this.obstacleVolume = this.options.multiplayer
      ? Number(this.roomSettings.obstacleVolume ?? settings.get('obstacleVolume'))
      : Number(this.options.obstacleVolume ?? settings.get('obstacleVolume'));
    this.difficulty = this.options.multiplayer
      ? (this.roomSettings.difficulty || settings.get('difficulty'))
      : (this.options.difficulty || settings.get('difficulty'));
    this.yetiStartMode = this.options.multiplayer
      ? (this.roomSettings.yetiStartMode || settings.get('yetiStartMode'))
      : settings.get('yetiStartMode');
    this.difficultyRamp = this.options.multiplayer
      ? !!this.roomSettings.difficultyRamp
      : (this.options.difficultyRamp !== undefined ? !!this.options.difficultyRamp : !!settings.get('difficultyRamp'));
    this.skillScoring = this.options.multiplayer
      ? !!this.roomSettings.skillScoring
      : (this.options.skillScoring !== undefined ? !!this.options.skillScoring : !!settings.get('skillScoring'));
    this.playerColor = sanitizePlayerColor(this.options.playerColor || DEFAULT_PLAYER_COLOR);
    this._useHighGraphics = this.graphicsQuality === 'high';
    this._authoritativeMultiplayer = !!this.options.multiplayer;
    this._authInputSeq = 0;
    this._authPredictionAccumulator = 0;
    this._authState = null;
    this._authPreviousState = null;
    this._authHasReceivedSnapshot = false;
    this._authLastServerTick = -1;
    this._authPendingInputs = [];
    this._authVisualCorrection = new THREE.Vector3();
    this._authVisualAngleCorrection = 0;
    this._authLastReconciliationError = 0;
    this._authLastSnapshotAt = 0;
    this._authSnapshotWarningFired = false;
    this._authSnapshotTimeoutFired = false;
    this._netDebugEnabled = new URLSearchParams(window.location.search).get('netDebug') === '1';
    this._netDebugElement = null;
    this._spectatorTargetId = null;
    this._authLocalSnapshotAlive = true;
    this._authLocalDeathHandled = false;
    this._predictedDeathRevealAt = 0;
    this._authConsumedPickupIds = new Set();
    this._authLastYetiWarning = 0;
    this._devModeEnabled = false;
    this._devOverlayElement = null;
    this._devHitboxGroup = null;
    this._devHitboxMaterials = null;
    this._devUnitBoxGeometry = null;
    this._devFpsAccum = 0;
    this._devFpsFrames = 0;
    this._devFps = 0;
    this._devPing = null;
    this._devPingTimer = 0;
    this._boundDevModeKeydown = this._onDevModeKeydown.bind(this);
    window.addEventListener('keydown', this._boundDevModeKeydown);

    this._setup();
    this._createNetDebugOverlay();
  }

  /**
   * Live-applies the cheap settings (fog density, snow volume) without
   * rebuilding the run. Fog is picked up automatically by
   * _updateWeatherVisuals, which re-derives the target density from
   * _baseFogFar every frame. Everything else (graphics quality, lighting,
   * obstacle layout, run rules) is baked at construction and applies from
   * the next run.
   */
  applySettingsLive(values) {
    if (values.fogLevel !== undefined) {
      this.fogLevel = Number(values.fogLevel);
      this._baseFogFar = getFogDistances(this._useHighGraphics, this.fogLevel).far;
    }
    if (values.snowVolume !== undefined) {
      this.snowVolume = Number(values.snowVolume);
      this.snow.setVolume(this.snowVolume);
    }
  }

  _onDevModeKeydown(e) {
    if (e.key !== "'" && e.code !== 'Quote') return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    e.preventDefault();
    this._setDevModeEnabled(!this._devModeEnabled);
  }

  _setDevModeEnabled(enabled) {
    this._devModeEnabled = enabled;
    if (enabled) {
      this._createDevOverlay();
      this._createDevHitboxGroup();
    } else {
      this._destroyDevOverlay();
      this._destroyDevHitboxGroup();
    }
  }

  _createDevOverlay() {
    if (this._devOverlayElement || !this.renderer?.domElement?.parentElement) return;
    const overlay = document.createElement('pre');
    overlay.style.cssText = [
      'position:absolute',
      'left:12px',
      'top:50%',
      'transform:translateY(-50%)',
      'z-index:250',
      'margin:0',
      'padding:7px 9px',
      'border:1px solid rgba(255,209,102,.55)',
      'border-radius:4px',
      'background:rgba(4,15,31,.72)',
      'color:#ffe066',
      'font:11px/1.35 ui-monospace,monospace',
      'pointer-events:none',
      'white-space:pre',
    ].join(';');
    overlay.textContent = 'dev mode: on';
    this.renderer.domElement.parentElement.appendChild(overlay);
    this._devOverlayElement = overlay;
  }

  _destroyDevOverlay() {
    this._devOverlayElement?.remove();
    this._devOverlayElement = null;
  }

  _createDevHitboxGroup() {
    if (this._devHitboxGroup) return;
    this._devUnitBoxGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this._devHitboxMaterials = new Map();
    this._devHitboxGroup = new THREE.Group();
    this._devHitboxGroup.renderOrder = 999;
    this.scene.add(this._devHitboxGroup);
  }

  _destroyDevHitboxGroup() {
    if (!this._devHitboxGroup) return;
    this.scene.remove(this._devHitboxGroup);
    this._devHitboxGroup.children.length = 0;
    this._devUnitBoxGeometry?.dispose();
    this._devUnitBoxGeometry = null;
    for (const material of this._devHitboxMaterials.values()) material.dispose();
    this._devHitboxMaterials = null;
    this._devHitboxGroup = null;
  }

  _getDevHitboxMaterial(color) {
    let material = this._devHitboxMaterials.get(color);
    if (!material) {
      material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      this._devHitboxMaterials.set(color, material);
    }
    return material;
  }

  _addDevHitbox(x, y, z, halfW, halfD, height, color) {
    const box = new THREE.LineSegments(this._devUnitBoxGeometry, this._getDevHitboxMaterial(color));
    box.scale.set(Math.max(halfW, 0.05) * 2, height, Math.max(halfD, 0.05) * 2);
    box.position.set(x, y + height / 2, z);
    this._devHitboxGroup.add(box);
  }

  _rebuildDevHitboxes() {
    if (!this._devHitboxGroup) return;
    this._devHitboxGroup.children.length = 0;

    this._addDevHitbox(
      this.player.position.x, this.player.position.y, this.player.position.z,
      this.player.halfW, this.player.halfD, 1.7, DEV_HITBOX_COLORS.player,
    );

    for (const [, rp] of this.remotePlayers) {
      if (!rp.mesh) continue;
      this._addDevHitbox(
        rp.mesh.position.x, rp.mesh.position.y, rp.mesh.position.z,
        DEV_REMOTE_HALF_W, DEV_REMOTE_HALF_D, 1.7, DEV_HITBOX_COLORS.remote,
      );
    }

    for (const obs of this.obstacles.getObstaclesNear(this.player.position.z, 45)) {
      if (obs.dead) continue;
      const color = DEV_HITBOX_COLORS[obs.type] || DEV_HITBOX_COLORS.default;
      const y = obs.mesh?.position?.y ?? 0;
      this._addDevHitbox(obs.x, y, obs.z, obs.halfW, obs.halfD, 1.4, color);
    }
  }

  _renderDevOverlay() {
    if (!this._devOverlayElement) return;
    const p = this.player;
    const ping = this._devPing == null ? '-' : `${Math.round(this._devPing)}ms`;
    this._devOverlayElement.textContent = [
      "DEV MODE (')",
      `fps: ${this._devFps.toFixed(0)}`,
      `pos: ${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)}`,
      `speed: ${p.speed.toFixed(2)}  angle: ${p.angle.toFixed(2)}`,
      `hp: ${p.hp}  alive: ${p.isAlive}  airborne: ${p.isAirborne}`,
      `mode: ${this.gameMode}  difficulty: ${this.difficulty}`,
      `ping: ${ping}`,
      `obstacles: ${this.obstacles.active.length}  remotes: ${this.remotePlayers.size}`,
      `skillScoring: ${this.skillScoring}  difficultyRamp: ${this.difficultyRamp}`,
      `chainCount: ${this._authoritativeMultiplayer ? this._authState?.chainCount : p.chainCount}  bonusDistance: ${(this._authoritativeMultiplayer ? this._authState?.bonusDistance : p.bonusDistance)?.toFixed(1)}`,
    ].join('\n');
  }

  _updateDevMode(dt) {
    if (!this._devModeEnabled) return;

    this._devFpsAccum += dt;
    this._devFpsFrames += 1;
    if (this._devFpsAccum >= 0.5) {
      this._devFps = this._devFpsFrames / this._devFpsAccum;
      this._devFpsAccum = 0;
      this._devFpsFrames = 0;
    }

    if (this.socket?.connected) {
      this._devPingTimer -= dt;
      if (this._devPingTimer <= 0) {
        this._devPingTimer = 1;
        this.socket.ping(ms => { this._devPing = ms; });
      }
    } else {
      this._devPing = null;
    }

    this._rebuildDevHitboxes();
    this._renderDevOverlay();
  }
  
  _setup() {
    // Scene
    this.scene = new THREE.Scene();
    const fogColor = 0xaec7dc;
    const fog = getFogDistances(this._useHighGraphics, this.fogLevel);
    this.scene.background = new THREE.Color(fogColor);
    // Exponential fog reads as a real medium the further you look into it -
    // dense/blizzard weather leans hard on this (see _updateWeatherVisuals).
    this.scene.fog = new THREE.FogExp2(fogColor, fogDensityFromFar(fog.far));
    this._baseFogFar = fog.far;
    this._baseFogColor = new THREE.Color(fogColor);
    this._blizzardFogColor = new THREE.Color(0xeef2f5);
    
    // Camera
    this.threeCamera = new THREE.PerspectiveCamera(
      65, window.innerWidth / window.innerHeight, 0.1, 300
    );
    this.camera = new GameCamera(this.threeCamera);
    
    // Lighting
    const hemi = new THREE.HemisphereLight(0xdcedff, 0x8aa4bd, this._useHighGraphics ? 0.82 : 0.78);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfffbec, this._useHighGraphics ? 1.35 : 1.15);
    sun.position.set(-26, 56, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this._useHighGraphics ? 2048 : 1024, this._useHighGraphics ? 2048 : 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.00025;
    this.scene.add(sun);
    this.sun = sun;
    this.hemi = hemi;
    // "_fixed*" are the true, one-time graphics-quality-scaled originals.
    // "_base*" (also used by _updateWeatherVisuals) are the current
    // biome-resting values, overwritten every frame by _updateBiomeVisuals
    // before weather blends further from them toward its blizzard target.
    this._fixedBaseSunIntensity = sun.intensity;
    this._fixedBaseHemiIntensity = hemi.intensity;
    this._baseSunIntensity = sun.intensity;
    this._baseHemiIntensity = hemi.intensity;
    this._biomeBlend = createBiomeBlendTarget();
    this._currentBiome = 'forest';
    this._biomeReliefMult = 1;

    if (this._useHighGraphics) {
      this.sky = new SkyBg(this.scene);
      this.mountains = new HorizonMountains(this.scene, fogColor);
      this.postFx = new PostFX(this.renderer, this.scene, this.threeCamera);
      this.wildlife = new Wildlife(this.scene);
      this.landmarks = new Landmarks(this.scene, this.options.seed || 12345, this.graphicsQuality);
      this.aurora = new Aurora(this.scene);
    }
    // Not gated behind _useHighGraphics like the above - a single cheap
    // plane, and seeing an oncoming blizzard is a readability/fairness cue
    // as much as atmosphere, so it shouldn't be low-quality-only missing.
    this.stormWall = new StormWall(this.scene);
    this._breathHeadPos = new THREE.Vector3();
    this._breathTimer = 2;
    
    // Subsystems
    const seed = this.options.seed || 12345;
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    
    this.terrain = this._useHighGraphics
      ? new SnowTerrain(this.scene, seed)
      : new Terrain(this.scene);
    this.obstacles = new Obstacles(this.scene, {
      volume: this.obstacleVolume,
      authoritativeSeed: this._authoritativeMultiplayer ? seed : null,
      difficultyRamp: this.difficultyRamp,
    });
    this.courseDecor = new CourseDecor(this.scene, seed, this.graphicsQuality);
    this.player = new Player(this.scene, colorToNumber(this.playerColor), this.options.playerName || 'Skier');
    this.ghostPlayer = (!this.options.multiplayer && this.options.ghostRecord)
      ? new GhostPlayer(this.scene, this.options.ghostRecord.keyframes, {
        color: colorToNumber(this.options.ghostRecord.color || this.playerColor),
      })
      : null;
    if (this.options.multiplayer) {
      this.player.grantInvincibility(MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS);
    }
    this.player.onDie = context => this._handleGameOver(context);
    this.player.onHit = (hp, pan = 0) => {
      this.ui.showHitFeedback();
      this.audio.playCollision(pan);
      this.audio.playHeartLost();
      this.camera.shake(0.35, 0.28);
      this.triggerHitstop(0.13);
      this.impactParticles.burst(this.player.position.x, this.player.position.y + 0.3, this.player.position.z, {
        count: 16,
        color: [0.42, 0.36, 0.32],
        speed: 3.2,
        spread: 1,
        upBias: 1.6,
        life: 0.5,
        groundY: this.player.position.y,
      });
    };
    this.player.onHeal = () => this.ui.showHealFeedback();
    this.player.onNearMiss = (bonus, pan = 0) => {
      this.ui.showNearMissFeedback(bonus);
      this.audio.playNearMiss(pan);
    };
    this.player.onJumpChain = (bonus, chainCount) => {
      this.ui.showJumpChainFeedback(bonus, chainCount);
      this.audio.playJumpChain();
    };
    this.player.onUnstuck = () => this.ui.showUnstuckFeedback();
    this.player.onJumpStart = () => this.audio.playJump();
    this.player.onJumpLand = airSeconds => {
      this.audio.playLand();
      if (airSeconds > 0.36) {
        this.ui.showLandingFeedback();
        this.player.playLandingSquash(Math.min(1.4, airSeconds * 1.6));
        this.camera.shake(Math.min(0.3, airSeconds * 0.35), 0.22);
        if (airSeconds > 0.6) this.triggerHitstop(0.09);
        this.impactParticles.burst(this.player.position.x, this.player.position.y + 0.05, this.player.position.z, {
          count: Math.round(8 + Math.min(1, airSeconds) * 10),
          color: [0.5, 0.82, 1],
          speed: 2.2,
          spread: 0.9,
          upBias: 1.3,
          life: 0.4,
          groundY: this.player.position.y,
        });
      }
    };
    this.snow = new SnowParticles(this.scene, {
      quality: this.graphicsQuality,
      volume: this.snowVolume,
    });
    this.skiTrail = new SkiTrail(this.scene);
    this.impactParticles = new ImpactParticles(this.scene);
    this._skiSprayCooldown = 0;
    this.input = new Input();
    this.yeti = new YetiManager(this.scene, {
      difficulty: this.difficulty,
      startMode: this.yetiStartMode,
    });
    
    // Pre-generate first few chunks
    for (let i = 0; i < 6; i++) {
      this.obstacles.generateChunk(i, new SeededRandom(seed + i * 7919));
      this.courseDecor.generateChunk(i);
    }
    this.terrain.update(0, 0, 0);
    
    // Remote players map
    this.remotePlayers = new Map();
    this.projectiles = [];
    
    // Distance tracking
    this._startZ = this.player.position.z;
    this._startTime = performance.now();
    
    // Yeti capture
    this.yeti.onCapture(() => {
      // In authoritative multiplayer the yeti is purely a local, cosmetic
      // chase sim with no knowledge of the server's actual distance/time
      // capture math — ending the run from here would desync the client
      // from the server, which is the sole authority on that death.
      if (this._authoritativeMultiplayer) return;
      this._handleGameOver({ capturedByYeti: true });
    });
    
    // Register score for self (with initial HP)
    this._scores.set('local', {
      id: 'local',
      name: this.options.playerName || 'You',
      color: this.playerColor,
      distance: 0,
      bonusDistance: 0,
      hp: MAX_HP,
      alive: true,
      local: true,
      startTime: performance.now()
    });

    if (this.options.multiplayer && Array.isArray(this.options.players)) {
      for (const player of this.options.players) {
        if (!player?.id || player.id === this.socket?.id) continue;
        this._scores.set(player.id, {
          id: player.id,
          name: player.name || 'Player',
          color: sanitizePlayerColor(player.color),
          distance: 0,
          alive: true,
        });
      }
    }
    
    // Socket events
    if (this.socket) {
      this._boundRemoteUpdate = data => this._onRemoteUpdate(data);
      this._boundPlayerLeft = data => this._onPlayerLeft(data);
      this._boundRemoteGameOver = data => this._onRemoteGameOver(data);
      this._boundCombatThrow = data => this._onCombatThrow(data);
      this._boundGameSnapshot = data => this._onGameSnapshot(data);

      this.socket.on('player:update', this._boundRemoteUpdate);
      this.socket.on('player:left', this._boundPlayerLeft);
      this.socket.on('player:gameover', this._boundRemoteGameOver);
      this.socket.on('combat:throw', this._boundCombatThrow);
      this.socket.on('game:snapshot', this._boundGameSnapshot);
    }

    if (this._authoritativeMultiplayer) {
      // Pre-seed the client-side sim on the same lane the server spawns the
      // player (createMultiplayerSpawnXs is deterministic from seed +
      // player count, and lane order matches the server's insertion order).
      // Without this the client starts at x=0 and the first snapshot snaps
      // sideways to the real lane (minor list: spawn snap).
      const players = (this.options && Array.isArray(this.options.players)) ? this.options.players : [];
      const ownId = this.socket?.id || 'local';
      const ownIndex = Math.max(0, players.findIndex(p => p && (p.id === ownId || p.id === 'local')));
      const spawnXs = createMultiplayerSpawnXs(this.seed, Math.max(1, players.length));
      this._authState = createInitialPlayerState(
        this.socket?.id || 'local',
        this.options.playerName || 'Skier',
        this.options.playerId || this.socket?.id || 'local',
        {
          x: spawnXs[ownIndex] ?? 0,
          z: 0,
          startZ: 0,
          color: this.playerColor,
        },
      );
      this._authPreviousState = { ...this._authState };
    }
  }

  _createNetDebugOverlay() {
    if (!this._netDebugEnabled || !this.renderer?.domElement?.parentElement) return;
    const overlay = document.createElement('pre');
    overlay.style.cssText = [
      'position:absolute',
      'right:12px',
      'bottom:12px',
      'z-index:20',
      'margin:0',
      'padding:7px 9px',
      'border:1px solid rgba(105,228,255,.55)',
      'border-radius:4px',
      'background:rgba(4,15,31,.72)',
      'color:#9eeeff',
      'font:11px/1.35 ui-monospace,monospace',
      'pointer-events:none',
    ].join(';');
    overlay.textContent = 'net: waiting for snapshot';
    this.renderer.domElement.parentElement.appendChild(overlay);
    this._netDebugElement = overlay;
  }

  _updateNetDebug() {
    if (!this._netDebugElement || !this._authoritativeMultiplayer) return;
    const acknowledged = Number(this._authState?.lastProcessedInputSeq) || 0;
    const age = this._authLastSnapshotAt ? Math.round(performance.now() - this._authLastSnapshotAt) : '-';
    this._netDebugElement.textContent = [
      `tick: ${this._authLastServerTick}`,
      `ack/input: ${acknowledged}/${this._authInputSeq}`,
      `pending: ${this._authPendingInputs.length}`,
      `snapshot age: ${age}ms`,
      `reconcile: ${this._authLastReconciliationError.toFixed(2)}m`,
    ].join('\n');
  }
  
  start() {
    this.audio.unlock();
    this.audio.setVolume(settings.get('sfxVolume'));
    this._running = true;
    this._lastTime = performance.now();
    this.ui.showGame({ gameMode: this.gameMode });
    this._loop(this._lastTime);
  }

  pause() {
    if (!this._running || this._gameOverSent) return false;
    this._running = false;
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    this.audio.silenceContinuous();
    return true;
  }

  resume() {
    if (this._running || this._gameOverSent) return false;
    this._running = true;
    this._lastTime = performance.now();
    this.audio.unlock();
    this.ui.showGame({ gameMode: this.gameMode });
    this._loop(this._lastTime);
    return true;
  }

  get isPaused() {
    return !this._running && !this._gameOverSent;
  }
  
  _loop(now) {
    if (!this._running) return;
    this._animFrame = requestAnimationFrame(t => this._loop(t));

    let dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = now;

    if (this._hitstopRemaining > 0) {
      this._hitstopRemaining -= dt;
      dt *= HITSTOP_TIME_SCALE;
    }

    this._update(dt);
    this._updateDevMode(dt);
    this._render();
  }

  /** Brief slow-motion pulse on hard impacts/landings - sells weight. */
  triggerHitstop(durationSeconds = 0.07) {
    this._hitstopRemaining = Math.max(this._hitstopRemaining, durationSeconds);
  }

  /** Stereo pan (-1..1) for a sound source offset dx meters from the player. */
  _panForDx(dx) {
    if (dx === undefined || dx === null) return 0;
    return clamp(dx / 8, -1, 1);
  }

  /** Occasional breath-fog puff near the player's head, more often when cold. */
  _updateBreathFog(dt, weather) {
    if (!this.player.isAlive) return;
    this._breathTimer -= dt;
    if (this._breathTimer > 0) return;
    const cold = this._currentBiome !== 'forest' || weather.fogIntensity > 0.3 || weather.grip < 0.9;
    this._breathTimer = cold ? (1.0 + Math.random()) : (2.5 + Math.random() * 2.5);
    const head = this.player.mesh.userData.skierParts?.head;
    if (!head) return;
    head.getWorldPosition(this._breathHeadPos);
    this.impactParticles.burst(this._breathHeadPos.x, this._breathHeadPos.y, this._breathHeadPos.z, {
      count: 3,
      color: [1, 1, 1],
      speed: 0.35,
      spread: 0.12,
      upBias: 2.0,
      life: 0.85,
      groundY: this._breathHeadPos.y - 5,
      gravityScale: 0.15,
      drift: { x: 0, y: 0.18, z: -0.35 },
    });
  }

  /** Periodic snow spray kicked up while carving hard on the ground. */
  _updateSkiSpray(dt, mesh, speed, isAirborne, groundYAt) {
    if (!mesh) return;
    this._skiSprayCooldown = Math.max(0, this._skiSprayCooldown - dt);
    if (isAirborne || this._skiSprayCooldown > 0) return;
    if (speed < 7 || Math.abs(this.input.lateralAxis) < 0.5) return;
    this._skiSprayCooldown = 0.09;
    const groundY = groundYAt ? groundYAt(mesh.position.x, mesh.position.z) : 0;
    this.impactParticles.burst(mesh.position.x, groundY + 0.04, mesh.position.z, {
      count: 4,
      color: [0.5, 0.82, 1],
      speed: 1.6,
      spread: 0.55,
      upBias: 1.1,
      life: 0.32,
      groundY,
    });
  }

  /**
   * Purely cosmetic - slowly evolves the world's palette/lighting with
   * distance (pine forest -> open alpine -> dusk cliffs). Must run before
   * _updateWeatherVisuals each frame: it rewrites the "resting" baseline
   * (_baseFogColor/_baseSunIntensity/_baseHemiIntensity) that weather then
   * blends further from toward its own blizzard target that same frame.
   */
  _updateBiomeVisuals(z) {
    const biome = getBiomeAtZ(z, this._biomeBlend);

    // Slow time-of-day drift toward golden hour, layered on top of the
    // biome-resolved colors before anything below reads them - see
    // DAY_DRIFT_SECONDS/DAY_DRIFT_MAX_STRENGTH. `biome` is scratch state
    // recomputed fresh every frame, so mutating it further here is safe.
    const driftT = clamp(this._elapsedSeconds / DAY_DRIFT_SECONDS, 0, 1) * DAY_DRIFT_MAX_STRENGTH;
    if (driftT > 0) {
      biome.skyTop.lerp(GOLDEN_HOUR.skyTop, driftT);
      biome.skyHorizon.lerp(GOLDEN_HOUR.skyHorizon, driftT);
      biome.skyGround.lerp(GOLDEN_HOUR.skyGround, driftT);
      biome.fogColor.lerp(GOLDEN_HOUR.fogColor, driftT);
      biome.sunColor.lerp(GOLDEN_HOUR.sunColor, driftT);
      biome.hemiSky.lerp(GOLDEN_HOUR.hemiSky, driftT);
      biome.hemiGround.lerp(GOLDEN_HOUR.hemiGround, driftT);
    }

    this._baseFogColor.copy(biome.fogColor);
    this._baseSunIntensity = this._fixedBaseSunIntensity * biome.sunIntensityMult;
    this._baseHemiIntensity = this._fixedBaseHemiIntensity;
    this.sun.color.copy(biome.sunColor);
    this.hemi.color.copy(biome.hemiSky);
    this.hemi.groundColor.copy(biome.hemiGround);
    this.sky?.setColors(biome.skyTop, biome.skyHorizon, biome.skyGround);
    this.mountains?.setBiomeTint(biome.mountainTint, biome.mountainTintT);
    this.terrain?.setBiomeTint?.(biome.snowTint);
    this.terrain?.setReliefMult?.(biome.terrainReliefMult);
    this.aurora?.setIntensity(biome.auroraIntensity);
    this._biomeReliefMult = biome.terrainReliefMult;
    this._currentBiome = getDominantBiome(z);
  }

  /** Purely cosmetic - tweens fog/snow toward the current weather zone's targets. */
  _updateWeatherVisuals(dt, weather) {
    if (!this.scene.fog) return;
    const blend = clamp(2.5 * dt, 0, 1);
    // Absolute (not just relative) cap so a blizzard is a real whiteout
    // regardless of the player's fogLevel/graphics settings - a straight
    // percentage cut of an already-far base distance barely reads.
    const targetFar = THREE.MathUtils.lerp(this._baseFogFar, Math.min(this._baseFogFar, 20), weather.fogIntensity);
    const targetDensity = fogDensityFromFar(targetFar);
    this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, targetDensity, blend);
    if (!this._weatherColorTarget) this._weatherColorTarget = new THREE.Color();
    this._weatherColorTarget.lerpColors(this._baseFogColor, this._blizzardFogColor, weather.fogIntensity);
    this.scene.fog.color.lerp(this._weatherColorTarget, blend);
    if (this.scene.background?.isColor) this.scene.background.lerp(this._weatherColorTarget, blend);
    this.snow?.setIntensity(weather.snowIntensity);

    // Fog alone still lets a shadow an obstacle casts on the ground read as
    // a dark tell against the whited-out snow before the obstacle itself is
    // legible - even dimmed, a shadow edge still shows as contrast against
    // a uniformly bright field. Softening the sun buys a smooth-looking
    // transition; actually dropping the shadow map once deep in the storm
    // is what removes the tell for good.
    if (this.sun) {
      const targetSun = THREE.MathUtils.lerp(this._baseSunIntensity, this._baseSunIntensity * 0.15, weather.fogIntensity);
      this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, targetSun, blend);
      this.sun.castShadow = weather.fogIntensity < 0.6;
    }
    if (this.hemi) {
      const targetHemi = THREE.MathUtils.lerp(this._baseHemiIntensity, this._baseHemiIntensity * 1.25, weather.fogIntensity);
      this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, targetHemi, blend);
    }

    const kind = weather.fogIntensity > 0.5 ? 'blizzard' : (weather.grip < 0.7 ? 'icy' : 'clear');
    if (kind !== this._lastWeatherKind) {
      if (kind !== 'clear') this.audio.playWeatherShift(kind);
      this._lastWeatherKind = kind;
    }
  }

  /**
   * Looks ahead to the next deterministic weather zone (see shared
   * getWeatherAtZ/WEATHER_ZONE_LENGTH) and, if it's a blizzard, parks the
   * StormWall visual at that boundary and fades it in over the approach so
   * the storm is visible coming from a distance rather than only appearing
   * once the player is already inside the fog/snow ramp.
   */
  _updateStormWall(z, weather, baseY) {
    if (!this.stormWall) return;
    const zoneIndex = Math.floor(z / WEATHER_ZONE_LENGTH);
    const nextZoneStart = (zoneIndex + 1) * WEATHER_ZONE_LENGTH;
    const nextWeather = getWeatherAtZ(this.seed, nextZoneStart + WEATHER_ZONE_LENGTH * 0.5);

    // Hide once already inside real fog (the wall would be redundant/behind
    // the camera by then) or if the upcoming zone isn't a blizzard at all.
    if (nextWeather.fogIntensity <= 0.5 || weather.fogIntensity > 0.35) {
      this.stormWall.setOpacity(0);
      return;
    }

    const distanceToWall = nextZoneStart - z;
    const t = clamp(1 - distanceToWall / STORM_WALL_LOOKAHEAD, 0, 1);
    this.stormWall.setPosition(nextZoneStart, baseY);
    this.stormWall.setOpacity(t * STORM_WALL_MAX_OPACITY);
  }

  /** Fades in a low tension drone as the player nears the yeti trigger range. */
  _updateYetiTension(distance) {
    if (this.yeti.startMode === 'disabled' || this.yeti.active) {
      this.audio.updateTension(0);
      return;
    }
    const triggerDistance = this.yeti.config?.triggerDistance ?? Infinity;
    const rampStart = triggerDistance * 0.7;
    const span = triggerDistance - rampStart;
    const t = span > 0 ? clamp((distance - rampStart) / span, 0, 1) : 0;
    this.audio.updateTension(t);
  }

  /**
   * Solo only: rewards surviving close to an active yeti instead of only
   * punishing capture. Position-based (uses the real chase sim), which is
   * only safe here because solo has no server to disagree with - see the
   * multiplayer version below, which is authoritative-driven instead.
   */
  _updateYetiDangerBonus(dt) {
    if (!this.skillScoring || !this.yeti.active || !this.player.isAlive) {
      this._yetiDangerT = 0;
      return;
    }
    let closest = Infinity;
    for (const yeti of this.yeti.yetis) {
      if (yeti.captured) continue;
      const d = yeti.mesh.position.distanceTo(this.player.position);
      if (d < closest) closest = d;
    }
    this._yetiDangerT = closest < YETI_DANGER_RADIUS ? clamp(1 - closest / YETI_DANGER_RADIUS, 0, 1) : 0;
    if (this._yetiDangerT > 0) {
      this.player.bonusDistance += dt * this._yetiDangerT * YETI_PROXIMITY_BONUS_RATE;
    }
  }

  /**
   * Multiplayer only: display-side estimate of the same danger gap the
   * server actually scores from (see maybeApplyYetiCapture) - cosmetic only,
   * the real bonusDistance/capture always comes from the server snapshot.
   * Reuses the exported getYetiConfig so the chase speed can't drift from
   * the real formula, but the trigger timestamp here is the client's own
   * elapsed-time clock, not the server's roomTimeMs, so treat this as an
   * approximation for the meter.
   */
  _updateYetiDangerDisplay(distance, speed) {
    if (!this.skillScoring || this.yetiStartMode === 'disabled') {
      this._yetiDangerT = 0;
      return;
    }
    const config = getYetiConfig(this.roomSettings);
    if (distance < config.triggerDistance) {
      this._yetiDangerT = 0;
      this._yetiTriggerAtElapsedS = -1;
      return;
    }
    if (this._yetiTriggerAtElapsedS < 0) {
      this._yetiTriggerAtElapsedS = this._elapsedSeconds;
    }
    const elapsedSinceTrigger = Math.max(0, this._elapsedSeconds - this._yetiTriggerAtElapsedS);
    const yetiDistance = config.triggerDistance + config.chaseSpeed * elapsedSinceTrigger;
    const gap = distance - yetiDistance;
    this._yetiDangerT = clamp(1 - gap / 100, 0, 1);
  }

  /** 1 = chain just extended, 0 = window about to expire and reset it. */
  _updateChainRemainingSolo() {
    if (!this.player.chainCount) {
      this._chainRemainingT = 0;
      return;
    }
    const elapsed = performance.now() - this.player._lastRampJumpAtMs;
    this._chainRemainingT = clamp(1 - elapsed / getChainWindowMs(this.player.momentum), 0, 1);
  }

  _updateChainRemainingAuthoritative() {
    if (!this._authState?.chainCount) {
      this._chainRemainingT = 0;
      return;
    }
    const nowMs = performance.now() - this._startTime;
    const elapsed = nowMs - this._authState.lastRampJumpAtMs;
    this._chainRemainingT = clamp(1 - elapsed / getChainWindowMs(this._authState.momentum), 0, 1);
  }

  _panForObstacleId(obstacleId) {
    if (!obstacleId) return 0;
    const obs = this.obstacles.active.find(o => o.id === obstacleId);
    if (!obs) return 0;
    return this._panForDx(obs.x - this.player.position.x);
  }

  /**
   * Camera environment (M12): terrain-height sampling for the floor clamp
   * (high-graphics visual relief only — flat terrain never dips) and the
   * nearby obstacle AABBs for pull-in avoidance. Closures stay fresh per
   * frame so the camera sees the current chunk/relief.
   */
  _buildCameraEnv(visualGroundY, focusZ) {
    return {
      groundHeightAt: visualGroundY || undefined,
      occluders: () => this.obstacles.getObstaclesNear(focusZ, 30),
    };
  }
  
  _update(dt) {
    if (this._authoritativeMultiplayer) {
      this._updateAuthoritativeMultiplayer(dt);
      return;
    }

    if (!this.player.isAlive) {
      const spectator = this.options.multiplayer ? this._getBestAliveRemotePlayer() : null;
      const focusPos = spectator?.rp?.mesh?.position || this.player.position;
      const visualGroundY = this._useHighGraphics
        ? (x, z) => getVisualTerrainY(x, z, focusPos.x, focusPos.z, this._biomeReliefMult)
        : null;
      this.player.updateDeathAnimation(dt, visualGroundY);

      if (this.options.multiplayer) {
        this._updateMultiplayerSpectator(dt, visualGroundY, spectator);
        return;
      }

      if (this.ghostPlayer) this.ghostPlayer.update(dt, performance.now() - this._startTime, visualGroundY);
      this.camera.update(dt, this.player.mesh, Math.max(this.player.speed, 4), this._buildCameraEnv(visualGroundY, this.player.position.z));
      this.sky?.update(this.threeCamera.position);
      this.mountains?.update(this.threeCamera.position);
    this.aurora?.update(dt, this.threeCamera.position);
      this.snow.update(dt, this.threeCamera.position, Math.max(this.player.speed, 4));
      this.audio.updateContinuous(0, 0, false);
      return;
    }
    
    // Compute current chunk
    const pz = this.player.position.z;
    const currentChunk = Math.floor(pz / CHUNK_SIZE);
    
    // Generate ahead. Chunks not yet generated when a chain is active get a
    // ramp density boost - safe here because solo caches each chunk forever
    // once generated (see Obstacles.chunks), so this can never retroactively
    // disagree with anything already rendered/collided against.
    for (let i = currentChunk; i <= currentChunk + 5; i++) {
      if (!this.obstacles.chunks.has(i)) {
        this.obstacles.generateChunk(i, new SeededRandom(this.seed + i * 7919), this.player.chainCount > 0);
      }
    }

    this._elapsedSeconds = (performance.now() - this._startTime) / 1000;
    const visualGroundY = this._useHighGraphics
      ? (x, z) => getVisualTerrainY(x, z, this.player.position.x, this.player.position.z, this._biomeReliefMult)
      : null;
    
    // Get nearby obstacles for collision
    const nearby = this.obstacles.getObstaclesNear(pz, 25);
    
    // Update player
    this._updateBiomeVisuals(pz);
    const weather = getWeatherAtZ(this.seed, pz);
    this._updateWeatherVisuals(dt, weather);
    this.stormWall?.update(dt);
    this._updateStormWall(pz, weather, this.player.position.y);
    this.player.update(dt, this.input, nearby, this.skillScoring, weather);
    if (this._ghostRecording) {
      this._ghostRecording.sampleTimer += dt;
      if (this._ghostRecording.sampleTimer >= GHOST_SAMPLE_INTERVAL_S) {
        this._ghostRecording.sampleTimer = 0;
        this._ghostRecording.keyframes.push({
          t: Math.round(performance.now() - this._startTime),
          x: round2(this.player.position.x),
          y: round2(this.player.position.y),
          z: round2(this.player.position.z),
          angle: round3(this.player.angle),
          airborne: this.player.isAirborne,
          speed: round2(this.player.speed),
        });
      }
    }
    if (this._spawnProtectionRemaining > 0) {
      this._spawnProtectionRemaining = Math.max(0, this._spawnProtectionRemaining - dt);
    }
    this._updateSkyMarioCombat(dt, visualGroundY);

    if (this.player.isAlive) {
      for (const [, rp] of this.remotePlayers) {
        if (this.player.collideWithSkier(rp.mesh, { id: rp.id, name: rp.name })) break;
      }
    }

    const boostHeld = this.input.boost || this.input.mouseSpeedFraction > 0.86;
    if (boostHeld && !this._boostHeld) this.audio.playBoost();
    this._boostHeld = boostHeld;
    
    // Distance and timer
    const distance = Math.max(0, this.player.position.z - this._startZ) + this.player.bonusDistance;
    const elapsed = performance.now() - this._startTime;
    this._scores.set('local', {
      id: 'local',
      name: this.options.playerName || 'You',
      distance,
      bonusDistance: this.player.bonusDistance,
      hp: this.player.hp,
      alive: this.player.isAlive,
      local: true,
      time: Math.floor(elapsed / 1000)
    });
    
    // Update subsystems
    this.terrain.update(pz, this._elapsedSeconds, this.player.position.x);
    this.obstacles.update(dt, pz, visualGroundY, weather.fogIntensity);
    this.courseDecor.update(dt, pz, visualGroundY);
    this.landmarks?.update(dt, pz, visualGroundY);
    this.yeti.update(
      dt,
      this.player.position,
      distance,
      visualGroundY,
      this.obstacles.getAvoidanceBlockers(pz, 110),
    );
    const yetiNear = this.yeti.isNearPlayer(this.player.position);
    const yetiThreats = this.yeti.getThreats(this.player.position);
    if (yetiNear && !this._yetiWasNear) {
      this.audio.playYetiRoar(this._panForDx(yetiThreats[0]?.dx));
    }
    this._yetiWasNear = yetiNear;
    this.ui.showYetiWarning(yetiNear);
    this.ui.updateYetiRadar(yetiThreats);
    this._updateYetiTension(distance);
    this._updateYetiDangerBonus(dt);
    this.camera.update(dt, this.player.mesh, this.player.speed, this._buildCameraEnv(visualGroundY, this.player.position.z));
    this.postFx?.update(this.player.speed);
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.aurora?.update(dt, this.threeCamera.position);
    this.wildlife?.update(dt, this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, this.player.speed);
    this.skiTrail.update(dt, this.player.position, this.player.angle, this.player.speed, this.player.isAirborne, visualGroundY);
    this._updateSkiSpray(dt, this.player.mesh, this.player.speed, this.player.isAirborne, visualGroundY);
    this._updateBreathFog(dt, weather);
    this.audio.updateWeatherFoley(dt, weather);
    this.impactParticles.update(dt);
    this._updateChainRemainingSolo();
    this.audio.updateContinuous(this.player.speed, this.player.angle, this.player.isAirborne);
    this.audio.updateMusic(dt, this.player.speed, this._yetiDangerT, this._chainRemainingT);
    const ambientCue = this.audio.updateAmbient(dt, this._currentBiome);
    if (ambientCue === 'bird') this.wildlife?.spawnForestBird(this.threeCamera.position);
    else if (ambientCue === 'echo') this.wildlife?.spawnEagle(this.threeCamera.position);

    // HUD
    this.ui.updateHUD(distance, this.player.speed, this.player.hp, {
      isAirborne: this.player.isAirborne,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: this._spawnProtectionRemaining,
      chainCount: this.player.chainCount || 0,
      chainRemainingT: this._chainRemainingT,
      momentum: this.player.momentum || 0,
      cleanStreakSeconds: this.player.cleanStreakSeconds || 0,
      yetiDangerT: this._yetiDangerT || 0,
      iceGripT: 1 - weather.grip,
      blizzardT: weather.fogIntensity,
    });
    
    // Update remote players
    for (const [, rp] of this.remotePlayers) {
      rp.update(dt, visualGroundY);
    }
    if (this.ghostPlayer) this.ghostPlayer.update(dt, performance.now() - this._startTime, visualGroundY);

    // Build player list for HUD
    const allPlayers = [];
    for (const [id, score] of this._scores) {
      allPlayers.push(score);
    }
    this.ui.updatePlayerList(allPlayers);
    
    // Network update
    if (this.socket && this.options.multiplayer) {
      this._netTimer += dt;
      if (this._netTimer >= 1 / NET_UPDATE_HZ) {
        this._netTimer = 0;
        this.socket.sendPlayerUpdate({
          ...this.player.getState(),
          distance,
        });
      }
    }
  }

  _buildAuthoritativeInput() {
    const mouseSpeedFraction = this.input.mouseSpeedFraction;
    return {
      seq: this._authInputSeq,
      clientTime: performance.now(),
      lateralAxis: this.input.lateralAxis,
      boost: this.input.boost || (mouseSpeedFraction !== null && mouseSpeedFraction > 0.58),
      brake: this.input.brake || (mouseSpeedFraction !== null && mouseSpeedFraction < 0.42),
      jumpPressed: this.input.jump,
      firePressed: this.input.fire,
    };
  }

  _updateAuthoritativeMultiplayer(dt) {
    if (!this._authState) return;
    this._updateSnapshotWatchdog();

    const focusState = this._authState;
    const spectator = focusState.alive ? null : this._getBestAliveRemotePlayer();
    const spectatorId = spectator?.id || null;
    if (!focusState.alive && spectatorId !== this._spectatorTargetId) {
      this._spectatorTargetId = spectatorId;
      this.camera.reset();
    } else if (focusState.alive) {
      this._spectatorTargetId = null;
    }
    const focusMesh = focusState.alive ? this.player.mesh : (spectator?.rp?.mesh || this.player.mesh);
    const focusSpeed = focusState.alive ? focusState.speed : (spectator?.rp?.currentSpeed || Math.max(this.player.speed, 4));
    const focusX = focusState.alive ? focusState.x : focusMesh.position.x;
    const focusZ = focusState.alive ? focusState.z : focusMesh.position.z;
    const currentChunk = Math.floor(focusZ / CHUNK_SIZE);
    for (let i = currentChunk; i <= currentChunk + 5; i++) {
      if (!this.obstacles.chunks.has(i)) {
        this.obstacles.generateChunk(i, new SeededRandom(this.seed + i * 7919));
      }
    }

    this._elapsedSeconds = (performance.now() - this._startTime) / 1000;
    const visualGroundY = this._useHighGraphics
      ? (x, z) => getVisualTerrainY(x, z, focusX, focusZ, this._biomeReliefMult)
      : null;

    if (focusState.alive) {
      this._authPredictionAccumulator = Math.min(this._authPredictionAccumulator + dt, SIM_DT * 4);
      while (this._authPredictionAccumulator >= SIM_DT) {
        this._authPreviousState = { ...this._authState };
        this._authInputSeq += 1;
        const input = this._buildAuthoritativeInput();
        input.seq = this._authInputSeq;
        this.socket?.sendPlayerInput(input);
        this._authPendingInputs.push({ ...input });
        if (this._authPendingInputs.length > 120) {
          this._authPendingInputs.splice(0, this._authPendingInputs.length - 120);
        }
        this._simulatePredictedAuthoritativeTick(this._authState, input, this._authConsumedPickupIds);
        this._authPredictionAccumulator -= SIM_DT;
      }
      this._applyAuthoritativeStateToLocalPlayer(this._getPredictedRenderState(), { dt });
      // update() (and the lean/squash/limb-animation it drives) never runs in
      // authoritative multiplayer since movement comes from the shared sim
      // instead — apply the same presentation-only pass here so it isn't a
      // static mesh, then re-assert the reconciliation-corrected yaw that
      // applyPresentation's own rotation.y write would otherwise clobber.
      this.player.applyPresentation(dt, this.input.lateralAxis);
      this.player.mesh.rotation.y = -(this.player.angle + this._authVisualAngleCorrection);
      // Cosmetic-only: real capture/death is server-authoritative (see the
      // onCapture guard above). This just gives multiplayer runs the same
      // visible chase presence solo has.
      this.yeti.update(
        dt,
        this.player.position,
        focusState.distance,
        visualGroundY,
        this.obstacles.getAvoidanceBlockers(focusState.z, 110),
      );
      this.ui.updateYetiRadar(this.yeti.getThreats(this.player.position));
      this._updateYetiTension(focusState.distance);
      this._updateYetiDangerDisplay(focusState.distance, focusState.speed);
    } else {
      this.player.updateDeathAnimation(dt, visualGroundY);
    }

    // Read-only for rendering - the canonical, physics-affecting weather call
    // already happened inside _simulatePredictedAuthoritativeTick above.
    this._updateBiomeVisuals(focusZ);
    const weather = getWeatherAtZ(this.seed, focusZ);
    this._updateWeatherVisuals(dt, weather);
    this.stormWall?.update(dt);
    this._updateStormWall(focusZ, weather, focusMesh.position.y);

    this.terrain.update(focusMesh.position.z, this._elapsedSeconds, focusMesh.position.x);
    this.obstacles.update(dt, focusMesh.position.z, visualGroundY, weather.fogIntensity);
    this.courseDecor.update(dt, focusMesh.position.z, visualGroundY);
    this.landmarks?.update(dt, focusMesh.position.z, visualGroundY);
    this.camera.update(dt, focusMesh, focusSpeed, this._buildCameraEnv(visualGroundY, focusZ));
    this.postFx?.update(focusSpeed);
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.aurora?.update(dt, this.threeCamera.position);
    this.wildlife?.update(dt, this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, focusSpeed);
    this.skiTrail.update(dt, this.player.position, this.player.angle, this.player.speed, this.player.isAirborne, visualGroundY);
    this._updateSkiSpray(dt, this.player.mesh, this.player.speed, this.player.isAirborne, visualGroundY);
    this._updateBreathFog(dt, weather);
    this.audio.updateWeatherFoley(dt, weather);
    this.impactParticles.update(dt);
    this._updateChainRemainingAuthoritative();
    this.audio.updateContinuous(focusState.alive ? focusState.speed : 0, this.player.angle, this.player.isAirborne);
    this.audio.updateMusic(dt, focusState.alive ? focusState.speed : 0, this._yetiDangerT, this._chainRemainingT);
    const ambientCue = this.audio.updateAmbient(dt, this._currentBiome);
    if (ambientCue === 'bird') this.wildlife?.spawnForestBird(this.threeCamera.position);
    else if (ambientCue === 'echo') this.wildlife?.spawnEagle(this.threeCamera.position);

    for (const [, rp] of this.remotePlayers) {
      rp.update(dt, visualGroundY);
    }

    this.ui.updateHUD(focusState.distance, focusState.speed, focusState.hp, {
      isAirborne: focusState.isAirborne,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: focusState.invincibilityRemaining,
      spectatorTarget: focusState.alive ? '' : (spectator?.score?.name || ''),
      chainCount: focusState.chainCount || 0,
      chainRemainingT: this._chainRemainingT,
      momentum: focusState.momentum || 0,
      cleanStreakSeconds: focusState.cleanStreakSeconds || 0,
      yetiDangerT: this._yetiDangerT || 0,
      iceGripT: 1 - weather.grip,
      blizzardT: weather.fogIntensity,
    });
    this.ui.updatePlayerList(this._getScoreList());
    if (performance.now() - this._authLastYetiWarning > 1000) {
      this.ui.showYetiWarning(false);
    }

    if (!focusState.alive && this._allPlayersFinished()) {
      this._scheduleFinalGameOver(650);
    }
    this._updateNetDebug();
  }

  _simulatePredictedAuthoritativeTick(state, input, consumedPickupIds) {
    const obstacles = getGameplayObstaclesNear(
      this.seed,
      state.z,
      32,
      this.obstacleVolume,
      consumedPickupIds,
      this.difficultyRamp,
    );
    const weather = getWeatherAtZ(this.seed, state.z);
    if (state.alive) this._predictedDeathRevealAt = 0;
    const officiallyAliveBeforePrediction = this._authLocalSnapshotAlive !== false && !this._authLocalDeathHandled;
    simulatePlayerTick(state, input, SIM_DT, obstacles, consumedPickupIds, performance.now() - this._startTime, this.skillScoring, weather);
    if (officiallyAliveBeforePrediction && state.alive === false) {
      // Predicted death: hold the "possibly alive" facade only for a short
      // window (long enough for an in-flight snapshot to override a wrong
      // prediction), then reveal the crash locally instead of hiding it
      // until the snapshot lands. Authoritative handling (scores, gameover)
      // still waits for the snapshot via _authLocalDeathHandled.
      const nowMs = performance.now();
      if (!this._predictedDeathRevealAt) this._predictedDeathRevealAt = nowMs;
      if (nowMs - this._predictedDeathRevealAt < PREDICTED_DEATH_REVEAL_MS) {
        state.alive = true;
        state.finished = false;
        state.hp = Math.max(1, state.hp || 1);
        state.deathKind = undefined;
      }
    }
  }

  _getPredictedRenderState() {
    const state = { ...this._authState };
    const residualDt = THREE.MathUtils.clamp(this._authPredictionAccumulator, 0, SIM_DT);
    if (!state.alive || residualDt <= 0) return state;

    if (state.isAirborne) {
      state.x = clamp(state.x + state.airVelocityX * residualDt, -55, 55);
      state.z += state.airVelocityZ * residualDt;
      state.y = Math.max(0, state.y + state.jumpVelocityY * residualDt - 0.5 * GRAVITY * residualDt * residualDt);
      return state;
    }

    // Render-only: steer across the residual slice of time since the last
    // authoritative tick using the latest live input, instead of holding
    // that tick's angle until the next one lands (~33ms of dead steering
    // input otherwise). this._authState itself is untouched, so the next
    // real tick still starts from the true pre-extrapolation angle.
    state.angle = clamp(
      state.angle + this.input.lateralAxis * PLAYER_TURN_RATE * residualDt,
      -PLAYER_MAX_TURN_ANGLE,
      PLAYER_MAX_TURN_ANGLE,
    );

    state.x = clamp(state.x + Math.sin(state.angle) * state.speed * residualDt, -55, 55);
    state.z += Math.cos(state.angle) * state.speed * residualDt;
    return state;
  }

  _setVisualReconciliation(previousLogicalState, previousPosition, previousAngle, state, snap = false) {
    const target = new THREE.Vector3(state.x, state.y, state.z);
    const logicalError = Math.hypot(
      previousLogicalState.x - state.x,
      previousLogicalState.y - state.y,
      previousLogicalState.z - state.z,
    );
    this._authLastReconciliationError = logicalError;
    if (snap || this._authLastReconciliationError > 8) {
      this._authVisualCorrection.set(0, 0, 0);
      this._authVisualAngleCorrection = 0;
      return;
    }
    // Normal prediction is usually less than one tick ahead of the latest
    // snapshot. It is not a reconciliation error and must not restart a
    // visual correction every 50 ms.
    if (this._authLastReconciliationError < 0.75) return;

    const correction = previousPosition.clone().sub(target);
    this._authVisualCorrection.copy(correction);
    this._authVisualAngleCorrection = Math.atan2(
      Math.sin(previousAngle - state.angle),
      Math.cos(previousAngle - state.angle),
    );
  }

  _applyAuthoritativeStateToLocalPlayer(state, options = {}) {
    const snap = !!options.snap || !state.alive;
    const dt = Math.max(0.001, Number(options.dt) || 1 / 60);
    if (snap) {
      this._authVisualCorrection.set(0, 0, 0);
      this._authVisualAngleCorrection = 0;
    } else {
      const decay = Math.exp(-12 * dt);
      this._authVisualCorrection.multiplyScalar(decay);
      this._authVisualAngleCorrection *= decay;
    }
    const renderPosition = new THREE.Vector3(state.x, state.y, state.z).add(this._authVisualCorrection);

    this.player.position.copy(renderPosition);
    this.player.mesh.position.copy(renderPosition);
    this.player.angle = state.angle;
    this.player.mesh.rotation.y = -(state.angle + this._authVisualAngleCorrection);
    this.player.speed = state.speed;
    this.player.hp = state.hp;
    this.player.isAlive = state.alive;
    this.player.isAirborne = state.isAirborne;
    this.player.jumpVelocityY = state.jumpVelocityY || 0;
    this.player.airTime = state.airTime || 0;
    this.player.mesh.visible = true;
    this._spawnProtectionRemaining = state.invincibilityRemaining;
  }

  _buildStateFromSnapshotPlayer(player) {
    return {
      ...this._authState,
      ...player,
      startZ: this._authState?.startZ ?? player.startZ ?? 0,
      jumpVelocityY: player.jumpVelocityY ?? this._authState?.jumpVelocityY ?? 0,
      airVelocityX: player.airVelocityX ?? this._authState?.airVelocityX ?? 0,
      airVelocityZ: player.airVelocityZ ?? this._authState?.airVelocityZ ?? 0,
      airTime: player.airTime ?? this._authState?.airTime ?? 0,
      airborneFromRamp: player.airborneFromRamp ?? this._authState?.airborneFromRamp ?? false,
      jumpHeld: this._authState?.jumpHeld ?? false,
      lastInputAtMs: this._authState?.lastInputAtMs ?? 0,
      bonusDistance: player.bonusDistance ?? this._authState?.bonusDistance ?? 0,
      chainCount: player.chainCount ?? this._authState?.chainCount ?? 0,
      momentum: player.momentum ?? this._authState?.momentum ?? 0,
      cleanStreakSeconds: player.cleanStreakSeconds ?? this._authState?.cleanStreakSeconds ?? 0,
      // Not sent in snapshots (see jumpHeld/lastInputAtMs above) - the skill
      // scoring window only needs to be locally consistent between real
      // ticks, and gets corrected like any other prediction error the next
      // time a snapshot's bonusDistance/distance lands.
      lastRampJumpAtMs: this._authState?.lastRampJumpAtMs ?? -Infinity,
    };
  }

  _replayPendingInputsFromSnapshot(baseState, serverConsumedPickupIds) {
    const lastProcessedSeq = Number(baseState.lastProcessedInputSeq) || 0;
    const pending = this._authPendingInputs.filter(input => Number(input.seq) > lastProcessedSeq);
    this._authPendingInputs = pending;
    if (!pending.length || baseState.alive === false) return baseState;

    const replayState = { ...baseState };
    const replayConsumed = new Set(serverConsumedPickupIds);
    for (const pendingInput of pending) {
      this._simulatePredictedAuthoritativeTick(replayState, pendingInput, replayConsumed);
    }
    this._authConsumedPickupIds = replayConsumed;
    return replayState;
  }

  _updateSnapshotWatchdog() {
    if (!this._authHasReceivedSnapshot || this._authLocalSnapshotAlive === false) return;
    const age = performance.now() - this._authLastSnapshotAt;
    if (age >= SNAPSHOT_TIMEOUT_MS && !this._authSnapshotTimeoutFired) {
      this._authSnapshotTimeoutFired = true;
      this.options.onSnapshotTimeout?.();
    } else if (age >= SNAPSHOT_WARNING_MS && !this._authSnapshotWarningFired) {
      this._authSnapshotWarningFired = true;
      this.ui.setError('Connection unstable — waiting for server…');
    }
  }

  _onGameSnapshot(snapshot) {
    if (!this._authoritativeMultiplayer || !snapshot) return;
    const receivedAtMs = performance.now();
    this._authLastSnapshotAt = receivedAtMs;
    const serverTick = Number(snapshot.serverTick);
    if (Number.isFinite(serverTick)) {
      if (serverTick <= this._authLastServerTick) return;
      this._authLastServerTick = serverTick;
    }

    const serverConsumedPickupIds = new Set(Array.isArray(snapshot.consumedPickupIds) ? snapshot.consumedPickupIds : []);
    if (Array.isArray(snapshot.consumedPickupIds)) {
      this._authConsumedPickupIds = new Set(snapshot.consumedPickupIds);
      for (const obs of this.obstacles.active) {
        if (this._authConsumedPickupIds.has(obs.id)) {
          obs.dead = true;
          if (obs.mesh) obs.mesh.visible = false;
        }
      }
    }

    const localId = this.socket?.id;
    const seen = new Set();
    for (const player of snapshot.players || []) {
      seen.add(player.id);
      const score = {
        id: player.id,
        name: player.name || 'Player',
        color: sanitizePlayerColor(player.color),
        distance: player.distance || 0,
        bonusDistance: player.bonusDistance || 0,
        hp: player.hp,
        alive: player.alive !== false,
        local: player.id === localId,
      };
      this._scores.set(player.id === localId ? 'local' : player.id, score);

      if (player.id === localId) {
        const previousLogicalState = { ...this._authState };
        const displayedPosition = this.player.position.clone();
        const displayedAngle = this.player.angle;
        const previousOfficialAlive = this._authLocalSnapshotAlive !== false;
        this._authLocalSnapshotAlive = player.alive !== false;
        const snapshotState = this._buildStateFromSnapshotPlayer(player);
        this._authState = this._replayPendingInputsFromSnapshot(snapshotState, serverConsumedPickupIds);
        this._authPreviousState = { ...this._authState };
        const snap = !this._authHasReceivedSnapshot || this._authInputSeq <= 1 || player.alive === false;
        this._authHasReceivedSnapshot = true;
        this._setVisualReconciliation(
          previousLogicalState,
          displayedPosition,
          displayedAngle,
          this._authState,
          snap,
        );
        if (snap) {
          this._applyAuthoritativeStateToLocalPlayer(this._authState, { snap: true });
        }
        if (previousOfficialAlive && player.alive === false) {
          this._handleAuthoritativeLocalDeath(player);
        }
        continue;
      }

      if (!this.remotePlayers.has(player.id)) {
        const rp = new RemotePlayer(this.scene, player.id, player.name || 'Player', player.color);
        this.remotePlayers.set(player.id, rp);
      } else if (player.name) {
        this.remotePlayers.get(player.id).setName(player.name);
      }
      this.remotePlayers.get(player.id).setColor(player.color);
      this.remotePlayers.get(player.id).receiveState({
        x: player.x,
        y: player.y,
        z: player.z,
        angle: player.angle,
        speed: player.speed,
        alive: player.alive !== false,
      }, serverTick, snapshot.roomTimeMs, receivedAtMs);
    }

    for (const [id, rp] of this.remotePlayers) {
      if (seen.has(id)) continue;
      rp.dispose();
      this.remotePlayers.delete(id);
      this._scores.delete(id);
    }

    for (const event of snapshot.events || []) {
      if (event.socketId !== localId) continue;
      if (event.type === 'hit') {
        this.ui.showHitFeedback();
        this.audio.playCollision(this._panForObstacleId(event.obstacleId));
        this.audio.playHeartLost();
        this.camera.shake(0.35, 0.28);
        this.triggerHitstop(0.13);
        this.impactParticles.burst(this.player.position.x, this.player.position.y + 0.3, this.player.position.z, {
          count: 16,
          color: [0.42, 0.36, 0.32],
          speed: 3.2,
          spread: 1,
          upBias: 1.6,
          life: 0.5,
          groundY: this.player.position.y,
        });
      } else if (event.type === 'heal') {
        this.ui.showHealFeedback();
      } else if (event.type === 'jump') {
        this.audio.playJump();
      } else if (event.type === 'landing') {
        this.audio.playLand();
        // The server doesn't report air time/impact speed on this event, so
        // this uses a fixed moderate intensity rather than the speed-scaled
        // one solo gets from onJumpLand's airSeconds.
        this.player.playLandingSquash(0.75);
        this.camera.shake(0.18, 0.2);
        this.impactParticles.burst(this.player.position.x, this.player.position.y + 0.05, this.player.position.z, {
          count: 12,
          color: [0.5, 0.82, 1],
          speed: 2.2,
          spread: 0.9,
          upBias: 1.3,
          life: 0.4,
          groundY: this.player.position.y,
        });
      } else if (event.type === 'near-miss') {
        this.ui.showNearMissFeedback(event.bonus ?? 1.5);
        this.audio.playNearMiss(this._panForObstacleId(event.obstacleId));
      } else if (event.type === 'jump-chain') {
        this.ui.showJumpChainFeedback(event.bonus ?? 4, event.chainCount ?? 0);
        this.audio.playJumpChain();
      } else if (event.type === 'yeti-warning') {
        this._authLastYetiWarning = performance.now();
        this.ui.showYetiWarning(true);
        if (!this._yetiWasNear) {
          const nearestThreat = this.yeti.getThreats(this.player.position)[0];
          this.audio.playYetiRoar(this._panForDx(nearestThreat?.dx));
        }
        this._yetiWasNear = true;
      } else if (event.type === 'yeti-capture') {
        this._authLastYetiWarning = performance.now();
        this.ui.showYetiWarning(true);
      } else if (event.type === 'unstuck') {
        this.ui.showUnstuckFeedback();
      }
    }

    if (this._allPlayersFinished()) {
      this._scheduleFinalGameOver(650);
    }
    this._updateNetDebug();
  }

  _handleAuthoritativeLocalDeath(player) {
    if (this._authLocalDeathHandled) return;
    this._authLocalDeathHandled = true;
    this._gameOverSent = true;
    this._gameOverDistance = player.distance || 0;
    this.player.isAlive = false;
    this.player.hp = player.hp || 0;
    this.player.startDeathAnimation({
      kind: player.deathKind || 'generic',
      impactSpeed: player.speed || this.player.speed,
    });
    this._scores.set('local', {
      id: this.socket?.id || 'local',
      name: player.name || this.options.playerName || 'You',
      color: sanitizePlayerColor(player.color || this.playerColor),
      distance: this._gameOverDistance,
      bonusDistance: player.bonusDistance || 0,
      hp: this.player.hp,
      alive: false,
      local: true,
      time: Math.floor((performance.now() - this._startTime) / 1000),
    });
    this.audio.stopAll();
    this.audio.playGameOver();
    this.options.onRunComplete?.({
      distance: this._gameOverDistance,
      scores: this._getScoreList(),
      multiplayer: true,
      gameMode: this.gameMode,
      playerName: this.options.playerName || 'Skier',
      difficulty: this.difficulty,
    });
  }

  _getScoreList() {
    return Array.from(this._scores.values()).map(score => ({ ...score }));
  }

  _getBestAliveRemotePlayer() {
    let best = null;
    for (const [id, score] of this._scores) {
      if (id === 'local' || score.alive === false) continue;
      const rp = this.remotePlayers.get(id);
      if (!rp) continue;
      if (!best || (score.distance || 0) > (best.score.distance || 0)) {
        best = { id, score, rp };
      }
    }
    return best;
  }

  _allPlayersFinished() {
    if (!this.options.multiplayer) return true;
    const scores = this._getScoreList();
    return scores.length > 0 && scores.every(score => score.alive === false);
  }

  _scheduleFinalGameOver(delayMs = GAME_OVER_SCREEN_DELAY_MS) {
    if (this._finalGameOverShown) return;
    this._finalGameOverShown = true;
    const distance = this._gameOverDistance || Math.max(0, this.player.position.z - this._startZ);
    window.setTimeout(() => {
      this.ui.showGameOver(distance, this._getScoreList(), {
        gameMode: this.gameMode,
        difficulty: this.difficulty,
        multiplayer: !!this.options.multiplayer,
        ghostSaved: this._pendingGhostSaved,
        dailyKey: this.dailyKey,
      });
    }, delayMs);
  }

  _updateMultiplayerSpectator(dt, visualGroundY, spectator = null) {
    this._elapsedSeconds = (performance.now() - this._startTime) / 1000;

    for (const [, rp] of this.remotePlayers) {
      rp.update(dt, visualGroundY);
    }

    this._updateProjectiles(dt, visualGroundY);

    const target = spectator || this._getBestAliveRemotePlayer();
    const spectatorId = target?.id || null;
    if (spectatorId !== this._spectatorTargetId) {
      this._spectatorTargetId = spectatorId;
      this.camera.reset();
    }
    const focusMesh = target?.rp?.mesh || this.player.mesh;
    const focusSpeed = target?.rp?.currentSpeed || Math.max(this.player.speed, 4);
    const focusZ = focusMesh.position.z;
    const focusX = focusMesh.position.x;
    const currentChunk = Math.floor(focusZ / CHUNK_SIZE);
    for (let i = currentChunk; i <= currentChunk + 5; i++) {
      if (!this.obstacles.chunks.has(i)) {
        this.obstacles.generateChunk(i, new SeededRandom(this.seed + i * 7919));
      }
    }

    this.terrain.update(focusZ, this._elapsedSeconds, focusX);
    this.obstacles.update(dt, focusZ, visualGroundY);
    this.courseDecor.update(dt, focusZ, visualGroundY);
    this.camera.update(dt, focusMesh, focusSpeed, this._buildCameraEnv(visualGroundY, focusZ));
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.aurora?.update(dt, this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, focusSpeed);
    this.audio.updateContinuous(0, 0, false);
    this.ui.showYetiWarning(false);
    this.ui.updateYetiRadar([]);
    this.ui.updateHUD(this._gameOverDistance, 0, this.player.hp, {
      isAirborne: false,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: 0,
      spectatorTarget: target?.score?.name || '',
      chainCount: 0,
      chainRemainingT: 0,
      momentum: 0,
      cleanStreakSeconds: 0,
      yetiDangerT: 0,
      iceGripT: 0,
      blizzardT: 0,
    });
    this.ui.updatePlayerList(this._getScoreList());

    if (this._allPlayersFinished()) {
      this._scheduleFinalGameOver(650);
    }
  }
  
  _onRemoteUpdate(data) {
    if (this._authoritativeMultiplayer) return;
    const { id, name, x, z, y, angle, speed, distance } = data;
    if (id === this.socket?.id) return;
    
    if (!this.remotePlayers.has(id)) {
      const rp = new RemotePlayer(this.scene, id, name || 'Player');
      this.remotePlayers.set(id, rp);
    } else if (name) {
      this.remotePlayers.get(id).setName(name);
    }
    this.remotePlayers.get(id).receiveState({ x, z, y, angle, speed });
    const previous = this._scores.get(id);
    this._scores.set(id, {
      id,
      name: name || previous?.name || id,
      distance: distance || previous?.distance || 0,
      alive: previous?.alive === false ? false : true,
    });
  }
  
  _onPlayerLeft(data) {
    const { id } = data;
    const rp = this.remotePlayers.get(id);
    if (rp) {
      rp.dispose();
      this.remotePlayers.delete(id);
    }
    this._scores.delete(id);
    if (!this.player.isAlive) {
      this._updateMultiplayerSpectator(0, null);
    }
  }
  
  _onRemoteGameOver(data) {
    const { id, name, distance } = data;
    if (this._authoritativeMultiplayer && id === this.socket?.id) {
      const officialDeath = {
        ...this._authState,
        ...data,
        alive: false,
        finished: true,
        hp: data.hp ?? this._authState?.hp ?? 0,
        speed: data.speed ?? this._authState?.speed ?? this.player.speed,
        deathKind: data.deathKind || data.kind || this._authState?.deathKind || 'generic',
        distance: distance ?? this._authState?.distance ?? 0,
      };
      this._authLocalSnapshotAlive = false;
      this._authState = officialDeath;
      this._authPreviousState = { ...officialDeath };
      this._applyAuthoritativeStateToLocalPlayer(officialDeath, { snap: true });
      this._handleAuthoritativeLocalDeath(officialDeath);
      if (this._allPlayersFinished()) {
        this._scheduleFinalGameOver(650);
      }
      return;
    }
    const previous = this._scores.get(id);
    this._scores.set(id, {
      id,
      name: name || previous?.name || id,
      color: sanitizePlayerColor(data.color || previous?.color),
      distance: distance ?? previous?.distance ?? 0,
      alive: false,
    });
    const rp = this.remotePlayers.get(id);
    const latestRemoteState = rp?.getLatestState();
    if (latestRemoteState) {
      rp.receiveState({
        ...latestRemoteState,
        speed: 0,
        alive: false,
      });
    }
    if (!this.player.isAlive) {
      this._updateMultiplayerSpectator(0, null);
    }
    if (this._authoritativeMultiplayer && this._allPlayersFinished()) {
      this._scheduleFinalGameOver(650);
    }
  }

  _onCombatThrow(data) {
    if (this.gameMode !== 'sky_mario') return;
    if (data.ownerId === this.socket?.id) return;
    this._spawnProjectile({
      ownerId: data.ownerId,
      x: Number(data.x) || 0,
      y: Number(data.y) || 0.8,
      z: Number(data.z) || 0,
      vx: Number(data.vx) || 0,
      vy: Number(data.vy) || 0,
      vz: Number(data.vz) || PROJECTILE_SPEED,
      remote: true,
    });
  }

  _updateSkyMarioCombat(dt, groundYAt = null) {
    if (this.gameMode !== 'sky_mario') return;
    this._throwCooldown = Math.max(0, this._throwCooldown - dt);
    const firePressed = this.input.fire;
    if (firePressed && !this._fireHeld && this._throwCooldown <= 0) {
      this._throwCooldown = SKY_MARIO_THROW_COOLDOWN;
      this._throwProjectile();
    }
    this._fireHeld = firePressed;
    this._updateProjectiles(dt, groundYAt);
  }

  _throwProjectile() {
    const angle = this.player.angle;
    const launchSpeed = PROJECTILE_SPEED + this.player.speed * 0.22;
    const vx = Math.sin(angle) * launchSpeed;
    const vz = Math.cos(angle) * launchSpeed;
    const projectile = {
      ownerId: this.socket?.id || 'local',
      x: this.player.position.x + Math.sin(angle) * 0.65,
      y: this.player.position.y + 0.82,
      z: this.player.position.z + Math.cos(angle) * 1.0,
      vx,
      vy: 1.2,
      vz,
      remote: false,
    };
    this._spawnProjectile(projectile);
    if (this.socket && this.options.multiplayer) {
      this.socket.sendCombatThrow(projectile);
    }
  }

  _spawnProjectile(data) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0xf5fbff,
        emissive: 0x8ed8ff,
        emissiveIntensity: 0.16,
        roughness: 0.55,
      }),
    );
    mesh.position.set(data.x, data.y, data.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.projectiles.push({
      ...data,
      mesh,
      life: PROJECTILE_LIFETIME,
      hit: false,
    });
  }

  _updateProjectiles(dt, groundYAt = null) {
    for (const p of this.projectiles) {
      if (p.hit) continue;
      p.life -= dt;
      p.vy -= 7.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const groundY = groundYAt ? groundYAt(p.x, p.z) : 0;
      if (p.y < groundY + 0.18) {
        p.y = groundY + 0.18;
        p.vy = Math.abs(p.vy) * 0.28;
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.z += dt * 5;

      if (p.ownerId !== 'local' && p.ownerId !== this.socket?.id && this.player.isAlive) {
        const dx = Math.abs(this.player.position.x - p.x);
        const dz = Math.abs(this.player.position.z - p.z);
        const dy = Math.abs((this.player.position.y + 0.65) - p.y);
        if (dx < 0.65 && dz < 0.9 && dy < 1.0) {
          p.hit = true;
          this.player.takeCombatHit({
            kind: 'skier',
            obstacleType: 'sky_mario_projectile',
            impactSpeed: PROJECTILE_SPEED,
            projectileX: p.x,
          });
        }
      }

      if (p.ownerId === 'local' || p.ownerId === this.socket?.id) {
        for (const [, rp] of this.remotePlayers) {
          const dx = Math.abs(rp.mesh.position.x - p.x);
          const dz = Math.abs(rp.mesh.position.z - p.z);
          const dy = Math.abs((rp.mesh.position.y + 0.65) - p.y);
          if (dx < 0.65 && dz < 0.9 && dy < 1.0) {
            p.hit = true;
            rp.mesh.rotation.x = -Math.PI * 0.5;
            rp.mesh.rotation.z += 1.1;
            break;
          }
        }
      }

      for (const obs of this.obstacles.getObstaclesNear(p.z, 3)) {
        if (obs.type !== 'npc' || obs.dead) continue;
        if (Math.abs(obs.x - p.x) < obs.halfW + 0.35 && Math.abs(obs.z - p.z) < obs.halfD + 0.35) {
          p.hit = true;
          obs.knockdownTimer = Math.max(obs.knockdownTimer || 0, 1.8);
          obs.speed *= 0.25;
          break;
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.hit && p.life > 0) continue;
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.projectiles.splice(i, 1);
    }
  }
  
  _handleGameOver(context = {}) {
    if (this._gameOverSent) return;
    this._gameOverSent = true;
    
    if (context.capturedByYeti) this.player.startDeathAnimation({ kind: 'yeti' });
    else this.player.startDeathAnimation(context);
    this.audio.stopAll();
    this.audio.playGameOver();
    
    const distance = Math.max(0, this.player.position.z - this._startZ) + this.player.bonusDistance;
    this._gameOverDistance = distance;
    this._gameOverTime = performance.now();
    this._scores.set('local', {
      id: 'local',
      name: this.options.playerName || 'You',
      color: this.playerColor,
      distance,
      bonusDistance: this.player.bonusDistance,
      hp: this.player.hp,
      alive: false,
      local: true,
      time: Math.floor((performance.now() - this._startTime) / 1000),
    });
    const scores = Array.from(this._scores.values());
    const ghostRecord = this._ghostRecording ? {
      version: 1,
      mode: this.gameMode,
      difficulty: this.difficulty,
      seed: this.seed,
      obstacleVolume: this.obstacleVolume,
      difficultyRamp: this.difficultyRamp,
      skillScoring: this.skillScoring,
      color: this.playerColor,
      distance,
      recordedAt: Date.now(),
      keyframes: this._ghostRecording.keyframes,
    } : null;
    const runResult = this.options.onRunComplete?.({
      distance,
      scores,
      multiplayer: !!this.options.multiplayer,
      gameMode: this.gameMode,
      playerName: this.options.playerName || 'Skier',
      difficulty: this.difficulty,
      ghostRecord,
      dailyKey: this.dailyKey,
    });
    this._pendingGhostSaved = !!runResult?.ghostSaved;

    if (this.socket && this.options.multiplayer) {
      this.socket.sendGameOver(distance);
    }

    if (this.options.multiplayer) {
      if (this._allPlayersFinished()) {
        this._scheduleFinalGameOver(context.capturedByYeti ? YETI_GAME_OVER_SCREEN_DELAY_MS : GAME_OVER_SCREEN_DELAY_MS);
      }
      return;
    }
    
    this._scheduleFinalGameOver(context.capturedByYeti ? YETI_GAME_OVER_SCREEN_DELAY_MS : GAME_OVER_SCREEN_DELAY_MS);
  }
  
  resize(w, h) {
    this.threeCamera.aspect = w / h;
    this.threeCamera.updateProjectionMatrix();
    this.postFx?.resize(w, h);
  }

  _render() {
    if (this.postFx) {
      this.postFx.render();
    } else {
      this.renderer.render(this.scene, this.threeCamera);
    }
  }
  
  destroy() {
    this._running = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    window.removeEventListener('keydown', this._boundDevModeKeydown);
    this._destroyDevOverlay();
    this._destroyDevHitboxGroup();
    this.input.destroy();
    this.terrain.dispose();
    this.obstacles.dispose();
    this.courseDecor.dispose();
    this.player.dispose();
    this.snow.dispose();
    this.skiTrail.dispose();
    this.impactParticles.dispose();
    this.audio.dispose();
    this.yeti.dispose();
    this.sky?.dispose();
    this.mountains?.dispose();
    this.postFx?.dispose();
    this.wildlife?.dispose();
    this.aurora?.dispose();
    this.stormWall?.dispose();
    this.landmarks?.dispose();
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    for (const [, rp] of this.remotePlayers) rp.dispose();
    this.remotePlayers.clear();
    this.ghostPlayer?.dispose();
    if (this.socket) {
      this.socket.off('player:update', this._boundRemoteUpdate);
      this.socket.off('player:left', this._boundPlayerLeft);
      this.socket.off('player:gameover', this._boundRemoteGameOver);
      this.socket.off('combat:throw', this._boundCombatThrow);
      this.socket.off('game:snapshot', this._boundGameSnapshot);
    }
  }
}
