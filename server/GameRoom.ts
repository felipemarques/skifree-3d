// @ts-nocheck
// GameRoom manages a single multiplayer room
const ROOM_ID_LENGTH = 6;
const DEFAULT_ROOM_SETTINGS = {
  gameMode: 'classic',
  difficulty: 'normal',
  yetiStartMode: 'distance',
  obstacleVolume: 1,
};
const VALID_GAME_MODES = new Set(['classic', 'sky_mario']);
const VALID_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'extreme']);
const VALID_YETI_START_MODES = new Set(['distance', 'immediate']);

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
  };
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

  addPlayer(socketId, name) {
    this.players.set(socketId, {
      id: socketId,
      name: name || 'Skier',
      distance: 0,
      state: null,
      finished: false,
    });
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (this.ownerId === socketId) {
      this.ownerId = this.players.keys().next().value || null;
    }
  }

  updatePlayerState(socketId, state) {
    const p = this.players.get(socketId);
    if (p) {
      p.state = state;
      if (state.distance !== undefined) p.distance = state.distance;
    }
  }

  getPlayerList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      distance: p.distance,
      finished: !!p.finished,
    }));
  }

  resetPlayersForRun() {
    for (const player of this.players.values()) {
      player.distance = 0;
      player.state = null;
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
