// @ts-nocheck
// SkiRoom absorbs what used to be split across server/index.ts's flat
// `io.on('connection', ...)` socket.io handlers and server/GameRoom.ts's
// plain data model - Colyseus dispatches per-room-instance rather than
// through one global namespace, so both responsibilities now live on one
// Room subclass. AuthoritativeRoomRuntime.ts (the tick loop/sim glue) is
// intentionally almost untouched: it keeps calling `this.room.players`,
// `this.room.settings`, `this.room.markPlayerFinished(...)`, etc, so this
// class exposes the exact same method/field names GameRoom used to.
const { Room } = require('colyseus');
const { DEFAULT_PLAYER_COLOR, PLAYER_COLOR_OPTIONS, PLAYER_TURN_RATE, sanitizePlayerColor } = require('../shared/AuthoritativeSim');
const { SimStateSchema } = require('../shared/RoomStateSchema');
const { RankingRepository } = require('./RankingRepository');
const { AuthoritativeRoomRuntime } = require('./AuthoritativeRoomRuntime');

const ROOM_ID_LENGTH = 6;
const DEFAULT_ROOM_SETTINGS = {
  gameMode: 'classic',
  difficulty: 'normal',
  yetiStartMode: 'distance',
  obstacleVolume: 1,
  difficultyRamp: false,
  skillScoring: false,
  snowballNpcs: false,
};
const VALID_GAME_MODES = new Set(['classic', 'sky_mario']);
const VALID_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'extreme']);
const VALID_YETI_START_MODES = new Set(['distance', 'immediate', 'disabled']);
const MULTIPLAYER_START_COUNTDOWN_SECONDS = 10;
// How long a mid-race disconnect holds the player's seat before it's given
// up for good - mirrors the old DISCONNECT_GRACE_MS, expressed in seconds
// for Colyseus's allowReconnection(client, seconds) API.
const DISCONNECT_GRACE_SECONDS = 15;
// How long an empty room (0 players) is kept alive before self-disposing -
// see onCreate's autoDispose comment. Comfortably longer than a "Play
// Again" round trip (leave old room -> lookup -> joinById).
const ROOM_EMPTY_DISPOSE_MS = 20000;
const MAX_ROOM_PLAYERS = 8;

// Rankings persistence is one shared SQLite-backed instance for the whole
// server process - index.ts's REST routes and every SkiRoom's finishRun()
// both import this same singleton rather than each opening their own.
const rankings = new RankingRepository();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeRoomSettings(input = {}) {
  return {
    gameMode: VALID_GAME_MODES.has(input.gameMode) ? input.gameMode : DEFAULT_ROOM_SETTINGS.gameMode,
    difficulty: VALID_DIFFICULTIES.has(input.difficulty) ? input.difficulty : DEFAULT_ROOM_SETTINGS.difficulty,
    yetiStartMode: VALID_YETI_START_MODES.has(input.yetiStartMode) ? input.yetiStartMode : DEFAULT_ROOM_SETTINGS.yetiStartMode,
    obstacleVolume: clamp(Number(input.obstacleVolume ?? DEFAULT_ROOM_SETTINGS.obstacleVolume) || 0, 0, 2),
    difficultyRamp: input.difficultyRamp === undefined ? DEFAULT_ROOM_SETTINGS.difficultyRamp : !!input.difficultyRamp,
    skillScoring: input.skillScoring === undefined ? DEFAULT_ROOM_SETTINGS.skillScoring : !!input.skillScoring,
    snowballNpcs: input.snowballNpcs === undefined ? DEFAULT_ROOM_SETTINGS.snowballNpcs : !!input.snowballNpcs,
  };
}

function getUsedPlayerColors(players, exceptSessionId = null) {
  return new Set(Array.from(players.values())
    .filter(player => player.id !== exceptSessionId)
    .map(player => sanitizePlayerColor(player.color)));
}

function getAvailablePlayerColor(players, requestedColor, exceptSessionId = null) {
  const requested = sanitizePlayerColor(requestedColor);
  const used = getUsedPlayerColors(players, exceptSessionId);
  if (!used.has(requested)) return requested;
  const fallback = PLAYER_COLOR_OPTIONS.find(option => !used.has(option.value));
  return fallback?.value || DEFAULT_PLAYER_COLOR;
}

class SkiRoom extends Room {
  onCreate(options = {}) {
    this.maxClients = MAX_ROOM_PLAYERS;
    // Manual disposal instead of Colyseus's default "dispose as soon as the
    // last client leaves" - "Play Again" (SocketClient.joinRoom) now leaves
    // the old room connection before joining a fresh one for the new run,
    // so a solo room (or the last player in one) briefly, legitimately hits
    // 0 players between the old session leaving and the new one joining.
    // Auto-dispose raced that gap: the room (and its matchmaker listing)
    // could vanish before the rejoin's /api/rooms/:code/lookup + joinById
    // completed, surfacing as "Room not found." _emptyDisposeTimer below
    // gives it a grace window instead, the same idea as
    // DISCONNECT_GRACE_SECONDS but for "everyone left" instead of "one
    // client dropped".
    this.autoDispose = false;
    this._emptyDisposeTimer = null;

    // The sim-state schema (per-tick player positions/etc + consumedPickupIds)
    // is patched manually by AuthoritativeRoomRuntime at its own cadence
    // (matching the old emitSnapshot()'s SNAPSHOT_HZ timing exactly), not on
    // Colyseus's own interval - see AuthoritativeRoomRuntime._syncState()'s
    // broadcastPatch() call.
    this.setState(new SimStateSchema());
    this.patchRate = null;

    this.roomCode = generateRoomCode();
    this.setMetadata({ code: this.roomCode });

    this.seed = Math.floor(Math.random() * 999999) + 1;
    this.settings = sanitizeRoomSettings(options.settings);
    this.ownerId = null;
    this.players = new Map(); // sessionId -> player record (mirrors old GameRoom.players)
    this.started = false;
    this.countdownTimer = null;
    this.countdownRemaining = null;
    this.createdAt = Date.now();
    this.runtime = null;

    this.onMessage('player:color', (client, message = {}) => {
      if (!this.updatePlayerColor(client.sessionId, message.color)) {
        client.send('room:error', { message: 'This color is already taken or the room is starting.' });
        return;
      }
      this.broadcast('room:state', this._roomStatePayload());
    });

    this.onMessage('room:updateSettings', (client, nextSettings) => {
      if (!this.updateSettings(client.sessionId, nextSettings)) {
        client.send('room:error', { message: 'Only the room host can change room settings before the game starts.' });
        return;
      }
      this.broadcast('room:state', this._roomStatePayload());
    });

    this.onMessage('game:start', (client) => {
      if (client.sessionId !== this.ownerId) {
        client.send('room:error', { message: 'Only the room host can start the game.' });
        return;
      }
      if (this.started || this.countdownTimer) return;
      this._startCountdown();
    });

    this.onMessage('player:input', (client, input) => {
      if (!this.started || !this.runtime) return;
      this.runtime.handleInput(client.sessionId, input);
    });

    // Legacy non-authoritative path - the runtime is always created once a
    // game actually starts (see game:start above), so this branch only
    // ever fires for a client that reports gameover before the countdown/
    // runtime exists, which shouldn't happen in practice; kept as a no-op
    // guard rather than removed outright.
    this.onMessage('player:gameover', (client, message = {}) => {
      if (this.started && this.runtime) return;
      const finishedPlayer = this.markPlayerFinished(client.sessionId, message.distance);
      this.broadcast('player:gameover', { id: client.sessionId, name: finishedPlayer?.name, distance: message.distance }, { except: client });
      if (this.started && this.allPlayersFinished()) this._finishRun();
    });

    this.onMessage('debug:ping', (client, payload) => {
      console.log(`[ping] recv seq=${payload?.seq} from=${client.sessionId} at=${Date.now()}`);
      client.send('debug:pong', payload);
    });
  }

  onJoin(client, options = {}) {
    if (this.started) {
      throw new Error('Room game already started.');
    }

    if (this._emptyDisposeTimer) {
      clearTimeout(this._emptyDisposeTimer);
      this._emptyDisposeTimer = null;
    }

    const { playerName, playerId, playerColor, turnRate } = options;
    const isCreator = this.players.size === 0;
    if (isCreator) this.ownerId = client.sessionId;

    this.addPlayer(client.sessionId, playerName, playerId, playerColor, turnRate);

    if (isCreator) {
      client.send('room:created', this._buildRoomPayload());
      console.log(`[room] ${this.roomCode} created by ${playerName}`);
    } else {
      client.send('room:joined', this._buildRoomPayload());
      this.broadcast('room:state', this._roomStatePayload(), { except: client });
      console.log(`[room] ${playerName} joined ${this.roomCode}`);
    }
  }

  async onLeave(client, consented) {
    const player = this.players.get(client.sessionId);
    if (!player) return;

    const midRace = this.started && !!this.runtime;
    if (!consented && midRace) {
      // Hold the seat instead of ending the run outright - a brief network
      // blip (or a phone backgrounding the tab) shouldn't cost the player
      // their run. Colyseus keeps the same sessionId across a successful
      // reconnect, so unlike the old socket.io version, no re-keying of the
      // runtime's player-state Map is needed at all.
      player.disconnectedAt = Date.now();
      this.broadcast('room:state', this._roomStatePayload());
      try {
        await this.allowReconnection(client, DISCONNECT_GRACE_SECONDS);
        player.disconnectedAt = null;
        // No manual pickup-resync needed - Colyseus's schema protocol
        // already sends this reconnecting client a correct full state sync.
        client.send('room:joined', this._buildRoomPayload({ resumed: true }));
        this.broadcast('room:state', this._roomStatePayload());
        console.log(`[room] ${player.name} reconnected to ${this.roomCode}`);
        return;
      } catch {
        // Grace window expired with no reconnect - fall through to removal.
      }
    }

    this._removePlayer(client.sessionId);
  }

  onDispose() {
    this.clearCountdown();
    if (this._emptyDisposeTimer) {
      clearTimeout(this._emptyDisposeTimer);
      this._emptyDisposeTimer = null;
    }
    if (this.runtime) {
      this.runtime.stop();
      this.runtime = null;
    }
  }

  // ---- GameRoom-compatible data model (kept as near-verbatim as possible
  // so AuthoritativeRoomRuntime.ts's `this.room.xxx(...)` calls need no
  // changes beyond the constructor/broadcast swap) ----

  addPlayer(sessionId, name, playerId = sessionId, playerColor = DEFAULT_PLAYER_COLOR, turnRate = PLAYER_TURN_RATE) {
    this.players.set(sessionId, {
      id: sessionId,
      playerId: String(playerId || sessionId).slice(0, 80),
      name: name || 'Skier',
      color: getAvailablePlayerColor(this.players, playerColor),
      turnRate: Math.min(4, Math.max(0.5, Number(turnRate) || PLAYER_TURN_RATE)),
      distance: 0,
      state: null,
      authoritativeState: null,
      finished: false,
    });
  }

  removePlayer(sessionId) {
    this.players.delete(sessionId);
    this.state.players.delete(sessionId);
    if (this.ownerId === sessionId) {
      this.ownerId = this.players.keys().next().value || null;
    }
  }

  updatePlayerState(sessionId, state) {
    const p = this.players.get(sessionId);
    if (p) {
      p.state = state;
      if (state.distance !== undefined) p.distance = state.distance;
    }
  }

  updateAuthoritativePlayerState(sessionId, state) {
    const p = this.players.get(sessionId);
    if (p) {
      p.authoritativeState = state;
      state.color = p.color;
      p.distance = Math.max(0, Math.round(Number(state.distance) || 0));
      p.finished = !!state.finished;
    }
  }

  updatePlayerColor(sessionId, color) {
    if (this.started || this.countdownTimer) return false;
    const player = this.players.get(sessionId);
    if (!player) return false;
    const nextColor = sanitizePlayerColor(color);
    const used = getUsedPlayerColors(this.players, sessionId);
    if (used.has(nextColor)) return false;
    player.color = nextColor;
    return true;
  }

  getPlayerList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      playerId: p.playerId,
      name: p.name,
      color: sanitizePlayerColor(p.color),
      distance: p.distance,
      finished: !!p.finished,
    }));
  }

  resetPlayersForRun() {
    for (const player of this.players.values()) {
      player.distance = 0;
      player.state = null;
      player.authoritativeState = null;
      player.finished = false;
    }
  }

  markPlayerFinished(sessionId, distance) {
    const player = this.players.get(sessionId);
    if (!player) return null;
    player.finished = true;
    player.distance = Math.max(player.distance || 0, Math.round(Number(distance) || 0));
    return player;
  }

  allPlayersFinished() {
    return this.players.size > 0 && Array.from(this.players.values()).every(player => player.finished);
  }

  updateSettings(sessionId, roomSettings) {
    if (sessionId !== this.ownerId || this.started || this.countdownTimer) return false;
    this.settings = sanitizeRoomSettings({ ...this.settings, ...roomSettings });
    return true;
  }

  clearCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.countdownRemaining = null;
  }

  // ---- Internal helpers ----

  _roomStatePayload() {
    return {
      players: this.getPlayerList(),
      ownerId: this.ownerId,
      settings: this.settings,
      countdown: this.countdownRemaining,
    };
  }

  // The `roomId` field in every payload is the short human-shareable code,
  // never Colyseus's own internal `this.roomId` - the client displays and
  // types in this value, so it must stay stable and match what the
  // /api/rooms/:code/lookup route (server/index.ts) indexes on.
  _buildRoomPayload(extra = {}) {
    return {
      roomId: this.roomCode,
      seed: this.seed,
      ...this._roomStatePayload(),
      ...extra,
    };
  }

  _startCountdown() {
    this.resetPlayersForRun();
    this.seed = Math.floor(Math.random() * 999999) + 1;
    this.countdownRemaining = MULTIPLAYER_START_COUNTDOWN_SECONDS;
    this.broadcast('room:countdown', { remaining: this.countdownRemaining });
    this.broadcast('room:state', this._roomStatePayload());

    this.countdownTimer = setInterval(() => {
      if (this.players.size === 0) {
        this.clearCountdown();
        return;
      }

      this.countdownRemaining = Math.max(0, Number(this.countdownRemaining) - 1);
      this.broadcast('room:countdown', { remaining: this.countdownRemaining });
      if (this.countdownRemaining > 0) return;

      this.clearCountdown();
      this.started = true;
      this.runtime = new AuthoritativeRoomRuntime(this, rankings, () => this._finishRun());
      this.runtime.start();
      this.broadcast('game:start', { seed: this.seed, settings: this.settings });
      console.log(`[room] ${this.roomCode} game started`);
    }, 1000);
  }

  _finishRun() {
    this.started = false;
    this.clearCountdown();
    if (this.runtime) {
      this.runtime.stop();
      this.runtime = null;
    }
    this.broadcast('room:state', this._roomStatePayload());
    console.log(`[room] ${this.roomCode} run finished`);
  }

  _removePlayer(sessionId) {
    if (!this.players.has(sessionId)) return;
    this.runtime?.removePlayer(sessionId);
    this.removePlayer(sessionId);
    this.broadcast('player:left', { id: sessionId });

    if (this.players.size === 0) {
      this.clearCountdown();
      if (this.runtime) {
        this.runtime.stop();
        this.runtime = null;
      }
      // Give a rejoin (e.g. "Play Again") a grace window to claim this room
      // back before it self-disposes - see onCreate's autoDispose comment.
      if (this._emptyDisposeTimer) clearTimeout(this._emptyDisposeTimer);
      this._emptyDisposeTimer = setTimeout(() => {
        this._emptyDisposeTimer = null;
        if (this.players.size === 0) this.disconnect();
      }, ROOM_EMPTY_DISPOSE_MS);
      return;
    }

    if (this.started && this.allPlayersFinished()) {
      this._finishRun();
      return;
    }

    this.broadcast('room:state', this._roomStatePayload());
  }
}

module.exports = { SkiRoom, rankings, sanitizeRoomSettings, DEFAULT_ROOM_SETTINGS };
