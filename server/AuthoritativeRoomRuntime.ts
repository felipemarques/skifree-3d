// @ts-nocheck
import {
  CHUNK_SIZE,
  SIM_DT,
  SIM_TICK_HZ,
  SNAPSHOT_HZ,
  FixedStepClock,
  OrderedInputBuffer,
  applyPlayerCollision,
  createInitialPlayerState,
  createMultiplayerSpawnXs,
  FORK_LANE_GAP,
  getForkZoneAhead,
  getGameplayObstaclesNear,
  getWeatherAtZ,
  maybeApplyAvalancheCapture,
  maybeApplyForkBonus,
  maybeApplyYetiCapture,
  simulatePlayerTick,
  simulateProjectilesTick,
  createProjectile,
  toSnapshotPlayer,
} from '../shared/AuthoritativeSim';
import { PlayerStateSchema } from '../shared/RoomStateSchema';

const INPUT_STALE_MS = 500;

// A Set that also mirrors newly-added ids into the room's schema-backed
// consumedPickupIds SetSchema - simulatePlayerTick (shared/AuthoritativeSim.ts)
// keeps treating this as a plain Set (only .has/.add are ever called on it
// there), but each *new* id also gets pushed into the schema set here, so
// Colyseus's own binary-diff patching broadcasts just that one new entry to
// every client - no hand-rolled delta array/full-resync-on-reconnect needed
// (Colyseus's schema protocol already sends a full state sync to a
// (re)joining client natively).
class TrackingIdSet extends Set {
  constructor(schemaSet) {
    super();
    this._schemaSet = schemaSet;
  }

  add(id) {
    if (!this.has(id)) this._schemaSet.add(id);
    return super.add(id);
  }
}

export class AuthoritativeRoomRuntime {
  constructor(room, rankings, onFinish) {
    this.room = room;
    this.rankings = rankings;
    this.onFinish = onFinish;
    this.tickTimer = null;
    this.serverTick = 0;
    this.roomTimeMs = 0;
    this.snapshotAccumulator = 0;
    this.tickClock = new FixedStepClock();
    this.events = [];
    this.consumedPickupIds = new TrackingIdSet(room.state.consumedPickupIds);
    // Chunk contents are fully determined by (seed, chunkIndex, volume,
    // difficultyRamp), all constant for a room's whole run - without this,
    // getGameplayObstaclesNear was re-running generateGameplayChunk's RNG
    // spawn loops from scratch for the same 4 chunks every sim tick, for
    // every player, and that recompute gets more expensive the further into
    // the run (higher chunk index -> higher ramped obstacle counts). Since
    // sustained boost is exactly what covers distance fastest, holding it
    // down drove the room into that more-expensive territory fastest -
    // exactly the "boost held for a long time -> multiplayer lag" symptom.
    this._chunkCache = new Map();
    this.savedRanking = false;
    this.players = new Map();
    this.inputBuffers = new Map();
    // Sky Mario combat - live server-authoritative projectiles, advanced/
    // hit-tested once per tick by simulateProjectilesTick after every
    // player has taken their movement tick (see the tick() loop below).
    // Empty array and no-op elsewhere for classic rooms.
    this.projectiles = [];
    this._projectileSeq = 0;

    const spawnXs = createMultiplayerSpawnXs(room.seed, room.players.size);
    let spawnIndex = 0;
    for (const [socketId, player] of room.players) {
      const state = createInitialPlayerState(socketId, player.name, player.playerId || socketId, {
        x: spawnXs[spawnIndex++] ?? 0,
        z: 0,
        startZ: 0,
        color: player.color,
        turnRate: player.turnRate,
      });
      this.players.set(socketId, state);
      this.inputBuffers.set(socketId, new OrderedInputBuffer());
      room.updateAuthoritativePlayerState(socketId, state);
    }
  }

  start() {
    if (this.tickTimer) return;
    this.tickClock.reset(Date.now());
    this.tickTimer = setInterval(() => this.pump(), Math.max(8, Math.floor(1000 / SIM_TICK_HZ / 2)));
    this._syncState();
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  pump() {
    const steps = this.tickClock.consume(Date.now());
    for (let step = 0; step < steps; step++) this.tick();
  }

  handleInput(socketId, input) {
    const state = this.players.get(socketId);
    if (!state || !state.alive) return;
    this.inputBuffers.get(socketId)?.push(input, this.roomTimeMs);
  }

  removePlayer(socketId) {
    const state = this.players.get(socketId);
    if (state) {
      state.alive = false;
      state.finished = true;
      state.deathKind = 'disconnect';
      this.room.markPlayerFinished(socketId, state.distance);
    }
    this.players.delete(socketId);
    this.inputBuffers.delete(socketId);
  }

  // Colyseus keeps the same sessionId across a successful reconnect (unlike
  // the old socket.io version, which needed reconnectPlayer() to re-key the
  // sim state/input buffer to a fresh socket id) - the player-state Map
  // entry is already right where it was, untouched. A reconnecting client
  // also gets a correct full-state resync for free from Colyseus's own
  // schema protocol (no hand-rolled forcePickupResync() needed anymore -
  // see shared/RoomStateSchema.ts).

  tick() {
    this.serverTick += 1;
    this.roomTimeMs += SIM_DT * 1000;

    const obstaclesByPlayer = new Map();
    for (const [socketId, state] of this.players) {
      const seat = this.room.players.get(socketId);
      if (!seat) continue;
      // Held during a disconnect grace period (see GameRoom.markDisconnected)
      // - freeze in place rather than simulating so they can't drift into a
      // hazard unattended while the seat waits to be reclaimed or expire.
      if (seat.disconnectedAt) continue;
      const input = this.getInputForPlayer(socketId, state);
      const obstacles = getGameplayObstaclesNear(
        this.room.seed,
        state.z,
        32,
        this.room.settings.obstacleVolume,
        this.consumedPickupIds,
        this.room.settings.difficultyRamp,
        this._chunkCache,
      );
      obstaclesByPlayer.set(socketId, obstacles);
      const weather = getWeatherAtZ(this.room.seed, state.z);
      const forkSafeLaneSlow = state.x < -FORK_LANE_GAP && getForkZoneAhead(this.room.seed, state.z, 0) !== null;
      const wasFinished = !!this.room.players.get(socketId)?.finished;
      const tickEvents = simulatePlayerTick(state, input, SIM_DT, obstacles, this.consumedPickupIds, this.roomTimeMs, this.room.settings.skillScoring, weather, forkSafeLaneSlow, this.room.seed, this.room.settings.gameMode);
      for (const event of tickEvents) {
        if (event.type === 'combat-throw') {
          this.projectiles.push(createProjectile(`p${++this._projectileSeq}`, socketId, event));
        }
      }
      this.events.push(...tickEvents);
      maybeApplyYetiCapture(state, this.room.settings, this.roomTimeMs, this.events, SIM_DT, this.room.settings.skillScoring);
      maybeApplyAvalancheCapture(state, this.room.seed, this.room.settings.difficulty, this.roomTimeMs, this.events, SIM_DT, this.room.settings.skillScoring);
      maybeApplyForkBonus(state, this.room.seed, this.events, this.room.settings.skillScoring);
      this.room.updateAuthoritativePlayerState(socketId, state);
      if (!state.alive && !wasFinished) {
        this.room.markPlayerFinished(socketId, state.distance);
        this.room.broadcast('player:gameover', {
          id: socketId,
          name: state.name,
          color: state.color,
          distance: state.distance,
          hp: state.hp,
          speed: state.speed,
          deathKind: state.deathKind,
        });
      }
    }

    const states = Array.from(this.players.values()).filter(state => this.room.players.has(state.id));
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const events = applyPlayerCollision(
          states[i],
          states[j],
          obstaclesByPlayer.get(states[i].id) ?? [],
          obstaclesByPlayer.get(states[j].id) ?? [],
        );
      if (events.length) {
        this.events.push(...events);
        for (const state of [states[i], states[j]]) {
          const wasFinished = !!this.room.players.get(state.id)?.finished;
          this.room.updateAuthoritativePlayerState(state.id, state);
          if (!state.alive && !wasFinished) {
            this.room.markPlayerFinished(state.id, state.distance);
            this.room.broadcast('player:gameover', {
              id: state.id,
              name: state.name,
              color: state.color,
              distance: state.distance,
              hp: state.hp,
              speed: state.speed,
              deathKind: state.deathKind,
            });
          }
        }
      }
      }
    }

    if (this.projectiles.length) {
      simulateProjectilesTick(this.projectiles, this.players.values(), SIM_DT, this.events);
      for (const state of states) {
        const wasFinished = !!this.room.players.get(state.id)?.finished;
        if (!state.alive && !wasFinished) {
          this.room.updateAuthoritativePlayerState(state.id, state);
          this.room.markPlayerFinished(state.id, state.distance);
          this.room.broadcast('player:gameover', {
            id: state.id,
            name: state.name,
            color: state.color,
            distance: state.distance,
            hp: state.hp,
            speed: state.speed,
            deathKind: state.deathKind,
          });
        }
      }
      this.projectiles = this.projectiles.filter(p => !p.hit);
    }

    this.snapshotAccumulator += SIM_DT;
    if (this.snapshotAccumulator >= 1 / SNAPSHOT_HZ) {
      this.snapshotAccumulator = 0;
      this._syncState();
    }

    if (this.room.started && this.room.allPlayersFinished()) {
      this.finishRun();
    }

    this._pruneChunkCache();
  }

  // Bounds _chunkCache's growth over a long run/session - only ever drops
  // chunks every player has already skied well past, so it never evicts
  // anything the hot per-tick lookup above still needs.
  _pruneChunkCache() {
    if (this._chunkCache.size < 48) return;
    let minChunk = Infinity;
    for (const state of this.players.values()) {
      minChunk = Math.min(minChunk, Math.floor(state.z / CHUNK_SIZE));
    }
    if (!Number.isFinite(minChunk)) return;
    for (const chunkIndex of this._chunkCache.keys()) {
      if (chunkIndex < minChunk - 4) this._chunkCache.delete(chunkIndex);
    }
  }

  getInputForPlayer(socketId, state) {
    return this.inputBuffers
      .get(socketId)
      ?.consume(state.lastProcessedInputSeq, this.roomTimeMs, INPUT_STALE_MS)
      ?? { seq: state.lastProcessedInputSeq, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false, firePressed: false };
  }

  // Replaces the old emitSnapshot()'s manual serialize-and-broadcast with
  // writing this tick's player fields onto the room's schema state and
  // letting Colyseus's own binary-diff patching figure out what actually
  // changed - see shared/RoomStateSchema.ts. consumedPickupIds is already
  // kept in sync incrementally by TrackingIdSet.add() above, not here.
  // Transient per-tick events aren't steady-state, so they stay a plain
  // broadcast message (now 'game:events' instead of living inside
  // 'game:snapshot') - sent just before the patch so it arrives at/before
  // the client's onStateChange fires for this same tick.
  _syncState() {
    this.room.state.serverTick = this.serverTick;
    this.room.state.roomTimeMs = Math.round(this.roomTimeMs);
    this.room.state.seed = this.room.seed;

    const liveSessionIds = new Set();
    for (const state of this.players.values()) {
      if (!this.room.players.has(state.id)) continue;
      liveSessionIds.add(state.id);
      let schemaPlayer = this.room.state.players.get(state.id);
      if (!schemaPlayer) {
        schemaPlayer = new PlayerStateSchema();
        this.room.state.players.set(state.id, schemaPlayer);
      }
      const snap = toSnapshotPlayer(state);
      for (const key in snap) {
        schemaPlayer[key] = key === 'deathKind' ? (snap[key] || '') : snap[key];
      }
    }
    for (const sessionId of this.room.state.players.keys()) {
      if (!liveSessionIds.has(sessionId)) this.room.state.players.delete(sessionId);
    }

    this.room.broadcast('game:events', this.events.splice(0));
    this.room.broadcastPatch();
  }

  async finishRun() {
    if (this.savedRanking) return;
    this.savedRanking = true;
    this.stop();
    this._syncState();

    for (const state of this.players.values()) {
      if (!state.playerId || state.distance <= 0) continue;
      try {
        await this.rankings.add({
          playerId: state.playerId,
          name: state.name,
          distance: state.distance,
          mode: this.room.settings.gameMode === 'sky_mario' ? 'multiplayer_sky_mario' : 'multiplayer',
          difficulty: this.room.settings.difficulty,
          date: Date.now(),
        });
      } catch (err) {
        console.error('[ranking]', err);
      }
    }

    this.onFinish?.();
  }
}
