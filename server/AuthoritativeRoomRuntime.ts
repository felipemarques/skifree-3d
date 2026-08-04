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
  toSnapshotPlayer,
} from '../shared/AuthoritativeSim';

const INPUT_STALE_MS = 500;

// A Set that also remembers, in insertion order, which ids were added since
// the last drainDelta() call - lets emitSnapshot() broadcast only newly-
// consumed pickup ids each tick instead of the whole match's history, while
// simulatePlayerTick (shared/AuthoritativeSim.ts) keeps using it as a plain
// Set (only .has/.add are ever called on it there).
class TrackingIdSet extends Set {
  add(id) {
    if (!this.has(id)) (this._pendingDelta ??= []).push(id);
    return super.add(id);
  }

  drainDelta() {
    const delta = this._pendingDelta || [];
    this._pendingDelta = [];
    return delta;
  }
}

export class AuthoritativeRoomRuntime {
  constructor(io, roomId, room, rankings, onFinish) {
    this.io = io;
    this.roomId = roomId;
    this.room = room;
    this.rankings = rankings;
    this.onFinish = onFinish;
    this.tickTimer = null;
    this.serverTick = 0;
    this.roomTimeMs = 0;
    this.snapshotAccumulator = 0;
    this.tickClock = new FixedStepClock();
    this.events = [];
    this.consumedPickupIds = new TrackingIdSet();
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
    // Forces the very next emitSnapshot() to send the full pickup-id history
    // instead of a delta - needed on room start and after a reconnect, so a
    // (re)joining client sees already-collected hearts as already gone.
    this._forcePickupResync = true;
    this.savedRanking = false;
    this.players = new Map();
    this.inputBuffers = new Map();

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
    this.emitSnapshot();
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

  // Mirrors GameRoom.reconnectPlayer - re-keys the sim state and input
  // buffer from the held (dead) socketId to the newly reconnected socket,
  // so a resumed player picks up mid-tick exactly where they left off
  // (position, hp, speed, invincibility, everything) instead of respawning.
  reconnectPlayer(oldSocketId, newSocketId) {
    const state = this.players.get(oldSocketId);
    if (!state) return false;
    this.players.delete(oldSocketId);
    state.id = newSocketId;
    this.players.set(newSocketId, state);

    const buffer = this.inputBuffers.get(oldSocketId);
    this.inputBuffers.delete(oldSocketId);
    this.inputBuffers.set(newSocketId, buffer || new OrderedInputBuffer());
    this._forcePickupResync = true;
    return true;
  }

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
      this.events.push(...simulatePlayerTick(state, input, SIM_DT, obstacles, this.consumedPickupIds, this.roomTimeMs, this.room.settings.skillScoring, weather, forkSafeLaneSlow));
      maybeApplyYetiCapture(state, this.room.settings, this.roomTimeMs, this.events, SIM_DT, this.room.settings.skillScoring);
      maybeApplyAvalancheCapture(state, this.room.seed, this.room.settings.difficulty, this.roomTimeMs, this.events, SIM_DT, this.room.settings.skillScoring);
      maybeApplyForkBonus(state, this.room.seed, this.events, this.room.settings.skillScoring);
      this.room.updateAuthoritativePlayerState(socketId, state);
      if (!state.alive && !wasFinished) {
        this.room.markPlayerFinished(socketId, state.distance);
        this.io.to(this.roomId).emit('player:gameover', {
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
            this.io.to(this.roomId).emit('player:gameover', {
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

    this.snapshotAccumulator += SIM_DT;
    if (this.snapshotAccumulator >= 1 / SNAPSHOT_HZ) {
      this.snapshotAccumulator = 0;
      this.emitSnapshot();
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

  emitSnapshot() {
    // Only the very first snapshot after room start/a reconnect carries the
    // full cumulative pickup-id history (so a (re)joining client can mark
    // already-collected hearts as gone); every other tick sends just the ids
    // consumed since the last snapshot. Without this, consumedPickupIds grew
    // for the whole match and was fully re-serialized/rebroadcast to the
    // entire room 30x/sec, getting progressively heavier the longer a match
    // (or a sustained boost run through pickups) went on.
    let consumedPickupIdsFull;
    let consumedPickupIdsDelta = this.consumedPickupIds.drainDelta();
    if (this._forcePickupResync) {
      consumedPickupIdsFull = Array.from(this.consumedPickupIds);
      consumedPickupIdsDelta = [];
      this._forcePickupResync = false;
    }
    const snapshot = {
      serverTick: this.serverTick,
      roomTimeMs: Math.round(this.roomTimeMs),
      seed: this.room.seed,
      settings: this.room.settings,
      players: Array.from(this.players.values())
        .filter(state => this.room.players.has(state.id))
        .map(toSnapshotPlayer),
      events: this.events.splice(0),
      consumedPickupIdsDelta,
      ...(consumedPickupIdsFull ? { consumedPickupIdsFull } : {}),
    };
    this.io.to(this.roomId).volatile.emit('game:snapshot', snapshot);
  }

  async finishRun() {
    if (this.savedRanking) return;
    this.savedRanking = true;
    this.stop();
    this.emitSnapshot();

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

    this.onFinish?.(this.roomId, this.room);
  }
}
