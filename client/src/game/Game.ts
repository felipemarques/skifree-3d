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

const CHUNK_SIZE = 80;
const NET_UPDATE_HZ = 20; // send position 20 times per second
const MAX_HP = 3;
const GAME_OVER_SCREEN_DELAY_MS = 1850;
const YETI_GAME_OVER_SCREEN_DELAY_MS = 2250;
const SKY_MARIO_THROW_COOLDOWN = 0.75;
const PROJECTILE_LIFETIME = 2.4;
const PROJECTILE_SPEED = 34;
const MULTIPLAYER_SPAWN_INVINCIBILITY_SECONDS = 5;

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
    this._useHighGraphics = this.graphicsQuality === 'high';
    
    this._setup();
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
    this.obstacles = new Obstacles(this.scene, { volume: this.obstacleVolume });
    this.courseDecor = new CourseDecor(this.scene, seed, this.graphicsQuality);
    this.player = new Player(this.scene, 0x2979ff, this.options.playerName || 'Skier');
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

      this.socket.on('player:update', this._boundRemoteUpdate);
      this.socket.on('player:left', this._boundPlayerLeft);
      this.socket.on('player:gameover', this._boundRemoteGameOver);
      this.socket.on('combat:throw', this._boundCombatThrow);
    }
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
    this._render();
  }
  
  _update(dt) {
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
    const previous = this._scores.get(id);
    this._scores.set(id, {
      id,
      name: name || previous?.name || id,
      distance: distance ?? previous?.distance ?? 0,
      alive: false,
    });
    if (!this.player.isAlive) {
      this._updateMultiplayerSpectator(0, null);
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
    }
  }
}
