// @ts-nocheck
import * as THREE from 'three';
import { Terrain } from './Terrain';
import { SnowTerrain } from './SnowTerrain';
import { Player } from './Player';
import { RemotePlayer } from './RemotePlayer';
import { Obstacles } from './Obstacles';
import { YetiManager } from './Yeti';
import { GameCamera } from './Camera';
import { SnowParticles } from './Snow';
import { Input } from './Input';
import { SeededRandom } from '../utils/SeededRandom';
import { AudioManager } from './AudioManager';
import { SkiTrail } from './SkiTrail';
import { SkyBg } from './SkyBg';
import { HorizonMountains } from './HorizonMountains';
import { PostFX } from './PostFX';
import { CourseDecor } from './CourseDecor';
import { settings } from '../utils/Settings';
import { getVisualTerrainY } from './VisualTerrain';
import {
  GRAVITY,
  SIM_DT,
  DEFAULT_PLAYER_COLOR,
  createInitialPlayerState,
  getGameplayObstaclesNear,
  sanitizePlayerColor,
  simulatePlayerTick,
} from '../../../shared/AuthoritativeSim';

const CHUNK_SIZE = 80;
const MAX_HP = 3;
const GAME_OVER_SCREEN_DELAY_MS = 1850;
const YETI_GAME_OVER_SCREEN_DELAY_MS = 2250;
const SKY_MARIO_THROW_COOLDOWN = 0.75;
const PROJECTILE_LIFETIME = 2.4;
const PROJECTILE_SPEED = 34;
const MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS = 5;
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

function getFogDistances(useHighGraphics, fogLevel) {
  const level = clamp(Number(fogLevel ?? 1), 0, 2);
  const baseNear = useHighGraphics ? 100 : 68;
  const baseFar = useHighGraphics ? 260 : 158;
  const lighter = Math.max(0, 1 - level);
  const heavier = Math.max(0, level - 1);

  const near = baseNear + lighter * 78 - heavier * 32;
  const far = baseFar + lighter * 92 - heavier * 50;

  return {
    near: Math.max(30, near),
    far: Math.max(near + 80, far),
  };
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
    this._netTimer = 0;
    this._animFrame = null;
    this._scores = new Map();
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
      : settings.get('obstacleVolume');
    this.difficulty = this.options.multiplayer
      ? (this.roomSettings.difficulty || settings.get('difficulty'))
      : settings.get('difficulty');
    this.yetiStartMode = this.options.multiplayer
      ? (this.roomSettings.yetiStartMode || settings.get('yetiStartMode'))
      : settings.get('yetiStartMode');
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
    this._netDebugEnabled = new URLSearchParams(window.location.search).get('netDebug') === '1';
    this._netDebugElement = null;
    this._spectatorTargetId = null;
    this._authLocalSnapshotAlive = true;
    this._authLocalDeathHandled = false;
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
    this.scene.fog = new THREE.Fog(fogColor, fog.near, fog.far);
    
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

    if (this._useHighGraphics) {
      this.sky = new SkyBg(this.scene);
      this.mountains = new HorizonMountains(this.scene, fogColor);
      this.postFx = new PostFX(this.renderer, this.scene, this.threeCamera);
    }
    
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
    });
    this.courseDecor = new CourseDecor(this.scene, seed, this.graphicsQuality);
    this.player = new Player(this.scene, colorToNumber(this.playerColor), this.options.playerName || 'Skier');
    if (this.options.multiplayer) {
      this.player.grantInvincibility(MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS);
    }
    this.player.onDie = context => this._handleGameOver(context);
    this.player.onHit = () => {
      this.ui.showHitFeedback();
      this.audio.playCollision();
      this.audio.playHeartLost();
    };
    this.player.onHeal = () => this.ui.showHealFeedback();
    this.player.onJumpStart = () => this.audio.playJump();
    this.player.onJumpLand = airSeconds => {
      this.audio.playLand();
      if (airSeconds > 0.36) this.ui.showLandingFeedback();
    };
    this.snow = new SnowParticles(this.scene, {
      quality: this.graphicsQuality,
      volume: this.snowVolume,
    });
    this.skiTrail = new SkiTrail(this.scene);
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
    this.yeti.onCapture(() => this._handleGameOver({ capturedByYeti: true }));
    
    // Register score for self (with initial HP)
    this._scores.set('local', { 
      id: 'local',
      name: this.options.playerName || 'You', 
      color: this.playerColor,
      distance: 0,
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
      this._authState = createInitialPlayerState(
        this.socket?.id || 'local',
        this.options.playerName || 'Skier',
        this.options.playerId || this.socket?.id || 'local',
        { color: this.playerColor },
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
    
    const dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = now;
    
    this._update(dt);
    this._updateDevMode(dt);
    this._render();
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
        ? (x, z) => getVisualTerrainY(x, z, focusPos.x, focusPos.z)
        : null;
      this.player.updateDeathAnimation(dt, visualGroundY);

      if (this.options.multiplayer) {
        this._updateMultiplayerSpectator(dt, visualGroundY, spectator);
        return;
      }

      this.camera.update(dt, this.player.mesh, Math.max(this.player.speed, 4));
      this.sky?.update(this.threeCamera.position);
      this.mountains?.update(this.threeCamera.position);
      this.snow.update(dt, this.threeCamera.position, Math.max(this.player.speed, 4));
      this.audio.updateContinuous(0, 0, false);
      return;
    }
    
    // Compute current chunk
    const pz = this.player.position.z;
    const currentChunk = Math.floor(pz / CHUNK_SIZE);
    
    // Generate ahead
    for (let i = currentChunk; i <= currentChunk + 5; i++) {
      if (!this.obstacles.chunks.has(i)) {
        this.obstacles.generateChunk(i, new SeededRandom(this.seed + i * 7919));
      }
    }

    this._elapsedSeconds = (performance.now() - this._startTime) / 1000;
    const visualGroundY = this._useHighGraphics
      ? (x, z) => getVisualTerrainY(x, z, this.player.position.x, this.player.position.z)
      : null;
    
    // Get nearby obstacles for collision
    const nearby = this.obstacles.getObstaclesNear(pz, 25);
    
    // Update player
    this.player.update(dt, this.input, nearby);
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
    const distance = Math.max(0, this.player.position.z - this._startZ);
    const elapsed = performance.now() - this._startTime;
    this._scores.set('local', { 
      id: 'local',
      name: this.options.playerName || 'You', 
      distance, 
      hp: this.player.hp,
      alive: this.player.isAlive,
      local: true,
      time: Math.floor(elapsed / 1000)
    });
    
    // Update subsystems
    this.terrain.update(pz, this._elapsedSeconds, this.player.position.x);
    this.obstacles.update(dt, pz, visualGroundY);
    this.courseDecor.update(dt, pz, visualGroundY);
    this.yeti.update(
      dt,
      this.player.position,
      distance,
      visualGroundY,
      this.obstacles.getAvoidanceBlockers(pz, 110),
    );
    const yetiNear = this.yeti.isNearPlayer(this.player.position);
    if (yetiNear && !this._yetiWasNear) this.audio.playYetiRoar();
    this._yetiWasNear = yetiNear;
    const yetiThreats = this.yeti.getThreats(this.player.position);
    this.ui.showYetiWarning(yetiNear);
    this.ui.updateYetiRadar(yetiThreats);
    this.camera.update(dt, this.player.mesh, this.player.speed);
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, this.player.speed);
    this.skiTrail.update(dt, this.player.position, this.player.angle, this.player.speed, this.player.isAirborne, visualGroundY);
    this.audio.updateContinuous(this.player.speed, this.player.angle, this.player.isAirborne);
    
    // HUD
    this.ui.updateHUD(distance, this.player.speed, this.player.hp, {
      isAirborne: this.player.isAirborne,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: this._spawnProtectionRemaining,
    });
    
    // Update remote players
    for (const [, rp] of this.remotePlayers) {
      rp.update(dt, visualGroundY);
    }
    
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
      ? (x, z) => getVisualTerrainY(x, z, focusX, focusZ)
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
    } else {
      this.player.updateDeathAnimation(dt, visualGroundY);
    }

    this.terrain.update(focusMesh.position.z, this._elapsedSeconds, focusMesh.position.x);
    this.obstacles.update(dt, focusMesh.position.z, visualGroundY);
    this.courseDecor.update(dt, focusMesh.position.z, visualGroundY);
    this.camera.update(dt, focusMesh, focusSpeed);
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, focusSpeed);
    this.skiTrail.update(dt, this.player.position, this.player.angle, this.player.speed, this.player.isAirborne, visualGroundY);
    this.audio.updateContinuous(focusState.alive ? focusState.speed : 0, this.player.angle, this.player.isAirborne);

    for (const [, rp] of this.remotePlayers) {
      rp.update(dt, visualGroundY);
    }

    this.ui.updateHUD(focusState.distance, focusState.speed, focusState.hp, {
      isAirborne: focusState.isAirborne,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: focusState.invincibilityRemaining,
      spectatorTarget: focusState.alive ? '' : (spectator?.score?.name || ''),
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
    );
    const officiallyAliveBeforePrediction = this._authLocalSnapshotAlive !== false && !this._authLocalDeathHandled;
    simulatePlayerTick(state, input, SIM_DT, obstacles, consumedPickupIds, performance.now() - this._startTime);
    if (officiallyAliveBeforePrediction && state.alive === false) {
      state.alive = true;
      state.finished = false;
      state.hp = Math.max(1, state.hp || 1);
      state.deathKind = undefined;
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
        this.audio.playCollision();
        this.audio.playHeartLost();
      } else if (event.type === 'heal') {
        this.ui.showHealFeedback();
      } else if (event.type === 'jump') {
        this.audio.playJump();
      } else if (event.type === 'landing') {
        this.audio.playLand();
      } else if (event.type === 'yeti-warning') {
        this._authLastYetiWarning = performance.now();
        this.ui.showYetiWarning(true);
        if (!this._yetiWasNear) this.audio.playYetiRoar();
        this._yetiWasNear = true;
      } else if (event.type === 'yeti-capture') {
        this._authLastYetiWarning = performance.now();
        this.ui.showYetiWarning(true);
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
      this.ui.showGameOver(distance, this._getScoreList());
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
    this.camera.update(dt, focusMesh, focusSpeed);
    this.sky?.update(this.threeCamera.position);
    this.mountains?.update(this.threeCamera.position);
    this.snow.update(dt, this.threeCamera.position, focusSpeed);
    this.audio.updateContinuous(0, 0, false);
    this.ui.showYetiWarning(false);
    this.ui.updateYetiRadar([]);
    this.ui.updateHUD(this._gameOverDistance, 0, this.player.hp, {
      isAirborne: false,
      graphicsQuality: this.graphicsQuality,
      spawnShieldSeconds: 0,
      spectatorTarget: target?.score?.name || '',
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
    
    const distance = Math.max(0, this.player.position.z - this._startZ);
    this._gameOverDistance = distance;
    this._gameOverTime = performance.now();
    this._scores.set('local', {
      id: 'local',
      name: this.options.playerName || 'You',
      color: this.playerColor,
      distance,
      hp: this.player.hp,
      alive: false,
      local: true,
      time: Math.floor((performance.now() - this._startTime) / 1000),
    });
    const scores = Array.from(this._scores.values());
    this.options.onRunComplete?.({
      distance,
      scores,
      multiplayer: !!this.options.multiplayer,
      gameMode: this.gameMode,
      playerName: this.options.playerName || 'Skier',
      difficulty: this.difficulty,
    });
    
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
    this.audio.dispose();
    this.yeti.dispose();
    this.sky?.dispose();
    this.mountains?.dispose();
    this.postFx?.dispose();
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    for (const [, rp] of this.remotePlayers) rp.dispose();
    this.remotePlayers.clear();
    if (this.socket) {
      this.socket.off('player:update', this._boundRemoteUpdate);
      this.socket.off('player:left', this._boundPlayerLeft);
      this.socket.off('player:gameover', this._boundRemoteGameOver);
      this.socket.off('combat:throw', this._boundCombatThrow);
      this.socket.off('game:snapshot', this._boundGameSnapshot);
    }
  }
}
