// @ts-nocheck
import {
  SIM_DT,
  SIM_TICK_HZ,
  SNAPSHOT_HZ,
  FixedStepClock,
  OrderedInputBuffer,
  applyPlayerCollision,
  createInitialPlayerState,
  createMultiplayerSpawnXs,
  getGameplayObstaclesNear,
  maybeApplyYetiCapture,
  simulatePlayerTick,
  toSnapshotPlayer,
} from '../shared/AuthoritativeSim';

const INPUT_STALE_MS = 500;

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
    this.consumedPickupIds = new Set();
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

  tick() {
    this.serverTick += 1;
    this.roomTimeMs += SIM_DT * 1000;

    for (const [socketId, state] of this.players) {
      if (!this.room.players.has(socketId)) continue;
      const input = this.getInputForPlayer(socketId, state);
      const obstacles = getGameplayObstaclesNear(
        this.room.seed,
        state.z,
        32,
        this.room.settings.obstacleVolume,
        this.consumedPickupIds,
      );
      const wasFinished = !!this.room.players.get(socketId)?.finished;
      this.events.push(...simulatePlayerTick(state, input, SIM_DT, obstacles, this.consumedPickupIds, this.roomTimeMs));
      maybeApplyYetiCapture(state, this.room.settings, this.roomTimeMs, this.events);
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
        const events = applyPlayerCollision(states[i], states[j]);
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
  }

  getInputForPlayer(socketId, state) {
    return this.inputBuffers
      .get(socketId)
      ?.consume(state.lastProcessedInputSeq, this.roomTimeMs, INPUT_STALE_MS)
      ?? { seq: state.lastProcessedInputSeq, clientTime: 0, lateralAxis: 0, boost: false, brake: false, jumpPressed: false, firePressed: false };
  }

  emitSnapshot() {
    const snapshot = {
      serverTick: this.serverTick,
      roomTimeMs: Math.round(this.roomTimeMs),
      seed: this.room.seed,
      settings: this.room.settings,
      players: Array.from(this.players.values())
        .filter(state => this.room.players.has(state.id))
        .map(toSnapshotPlayer),
      events: this.events.splice(0),
      consumedPickupIds: Array.from(this.consumedPickupIds),
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
