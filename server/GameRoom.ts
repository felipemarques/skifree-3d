// @ts-nocheck
// GameRoom manages a single multiplayer room
const { DEFAULT_PLAYER_COLOR, PLAYER_COLOR_OPTIONS, PLAYER_TURN_RATE, sanitizePlayerColor } = require('../shared/AuthoritativeSim');

const ROOM_ID_LENGTH = 6;
const DEFAULT_ROOM_SETTINGS = {
  gameMode: 'classic',
  difficulty: 'normal',
  yetiStartMode: 'distance',
  obstacleVolume: 1,
  difficultyRamp: false,
  skillScoring: false,
};
const VALID_GAME_MODES = new Set(['classic', 'sky_mario']);
const VALID_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'extreme']);
const VALID_YETI_START_MODES = new Set(['distance', 'immediate', 'disabled']);

function generateRoomId() {
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
  };
}

function getUsedPlayerColors(players, exceptSocketId = null) {
  return new Set(Array.from(players.values())
    .filter(player => player.id !== exceptSocketId)
    .map(player => sanitizePlayerColor(player.color)));
}

function getAvailablePlayerColor(players, requestedColor, exceptSocketId = null) {
  const requested = sanitizePlayerColor(requestedColor);
  const used = getUsedPlayerColors(players, exceptSocketId);
  if (!used.has(requested)) return requested;
  const fallback = PLAYER_COLOR_OPTIONS.find(option => !used.has(option.value));
  return fallback?.value || DEFAULT_PLAYER_COLOR;
}

class GameRoom {
  constructor(id, seed, ownerId, roomSettings = {}) {
    this.id = id;
    this.seed = seed;
    this.ownerId = ownerId;
    this.settings = sanitizeRoomSettings(roomSettings);
    this.players = new Map(); // socketId -> { id, name, distance, state }
    this.started = false;
    this.countdownTimer = null;
    this.countdownRemaining = null;
    this.createdAt = Date.now();
  }

  addPlayer(socketId, name, playerId = socketId, playerColor = DEFAULT_PLAYER_COLOR, turnRate = PLAYER_TURN_RATE) {
    this.players.set(socketId, {
      id: socketId,
      playerId: String(playerId || socketId).slice(0, 80),
      name: name || 'Skier',
      color: getAvailablePlayerColor(this.players, playerColor),
      turnRate: Math.min(4, Math.max(0.5, Number(turnRate) || PLAYER_TURN_RATE)),
      distance: 0,
      state: null,
      authoritativeState: null,
      finished: false,
    });
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (this.ownerId === socketId) {
      this.ownerId = this.players.keys().next().value || null;
    }
  }

  // Marks a mid-race player as disconnected without removing their seat -
  // see index.ts's disconnect handler, which starts a grace timer instead
  // of an immediate removePlayer() so a brief network blip doesn't end the
  // run. The seat stays keyed by the now-dead socketId until either
  // reconnectPlayer() re-keys it under a fresh socket, or the grace timer
  // expires and calls removePlayer() for real.
  markDisconnected(socketId) {
    const player = this.players.get(socketId);
    if (player) player.disconnectedAt = Date.now();
    return player || null;
  }

  // Finds a held (disconnected, grace-period) seat by the stable playerId a
  // reconnecting client sends - the Socket.IO socket id is necessarily
  // different after a reconnect, so socketId alone can't find it.
  findDisconnectedSeatByPlayerId(playerId) {
    if (!playerId) return null;
    for (const [socketId, player] of this.players) {
      if (player.disconnectedAt && player.playerId === playerId) return socketId;
    }
    return null;
  }

  // Re-keys a held seat from its old (dead) socketId to the newly
  // reconnected socket's id, preserving the player record (color, name,
  // distance, etc.) instead of treating the reconnect as a brand-new join.
  reconnectPlayer(oldSocketId, newSocketId) {
    const player = this.players.get(oldSocketId);
    if (!player) return null;
    this.players.delete(oldSocketId);
    player.id = newSocketId;
    player.disconnectedAt = null;
    this.players.set(newSocketId, player);
    if (this.ownerId === oldSocketId) this.ownerId = newSocketId;
    return player;
  }

  updatePlayerState(socketId, state) {
    const p = this.players.get(socketId);
    if (p) {
      p.state = state;
      if (state.distance !== undefined) p.distance = state.distance;
    }
  }

  updateAuthoritativePlayerState(socketId, state) {
    const p = this.players.get(socketId);
    if (p) {
      p.authoritativeState = state;
      state.color = p.color;
      p.distance = Math.max(0, Math.round(Number(state.distance) || 0));
      p.finished = !!state.finished;
    }
  }

  updatePlayerColor(socketId, color) {
    if (this.started || this.countdownTimer) return false;
    const player = this.players.get(socketId);
    if (!player) return false;
    const nextColor = sanitizePlayerColor(color);
    const used = getUsedPlayerColors(this.players, socketId);
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

  markPlayerFinished(socketId, distance) {
    const player = this.players.get(socketId);
    if (!player) return null;
    player.finished = true;
    player.distance = Math.max(player.distance || 0, Math.round(Number(distance) || 0));
    return player;
  }

  allPlayersFinished() {
    return this.players.size > 0 && Array.from(this.players.values()).every(player => player.finished);
  }

  updateSettings(socketId, roomSettings) {
    if (socketId !== this.ownerId || this.started || this.countdownTimer) return false;
    this.settings = sanitizeRoomSettings({ ...this.settings, ...roomSettings });
    return true;
  }

  clearCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.countdownRemaining = null;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  isFull() {
    return this.players.size >= 8;
  }
}

module.exports = {
  GameRoom,
  generateRoomId,
  sanitizeRoomSettings,
  DEFAULT_ROOM_SETTINGS,
};
