import * as THREE from 'three';
import { Game } from '@/game/Game';
import { MenuBackdrop } from '@/game/MenuBackdrop';
import { SocketClient } from '@/net/SocketClient';
import { rankingStore } from '@/utils/RankingStore';
import { settings } from '@/utils/Settings';
import { DEFAULT_PLAYER_COLOR, sanitizePlayerColor } from '../../../shared/AuthoritativeSim';
import type {
  ControllerSnapshot,
  GameMode,
  GameSettings,
  PlayerStatus,
  RankingEntry,
  RoomSettings,
  UiAdapter,
} from '@/types/app';
import type { UiStore } from './uiStore';

const PLAYER_NAME_KEY = 'skifree3d_player_name';
const PLAYER_COLOR_KEY = 'skifree3d_player_color';
const blockedBrowserShortcutKeys = new Set(['s', 'o', 'a', 'b', 'f', 'p', 'w', 'q']);

type SnapshotListener = () => void;

function normalizePlayerName(value: string) {
  return String(value || '').trim().slice(0, 16) || 'Skier';
}

function loadSavedPlayerName() {
  try {
    return normalizePlayerName(localStorage.getItem(PLAYER_NAME_KEY) || 'Skier');
  } catch (e) {
    return 'Skier';
  }
}

function loadSavedPlayerColor() {
  try {
    return sanitizePlayerColor(localStorage.getItem(PLAYER_COLOR_KEY) || DEFAULT_PLAYER_COLOR);
  } catch (e) {
    return DEFAULT_PLAYER_COLOR;
  }
}

function randomSeed() {
  return Math.floor(Math.random() * 999999) + 1;
}

function getRankingMode(result: any) {
  if (result.gameMode === 'sky_mario') {
    return result.multiplayer ? 'multiplayer_sky_mario' : 'sky_mario';
  }
  return result.multiplayer ? 'multiplayer' : 'classic';
}

function normalizeRoomSettings(nextSettings: Partial<RoomSettings> = {}): RoomSettings {
  const yetiStartMode = ['distance', 'immediate', 'disabled'].includes(String(nextSettings.yetiStartMode))
    ? nextSettings.yetiStartMode as RoomSettings['yetiStartMode']
    : 'distance';

  return {
    gameMode: nextSettings.gameMode === 'sky_mario' ? 'sky_mario' : 'classic',
    difficulty: ['easy', 'hard', 'extreme'].includes(String(nextSettings.difficulty))
      ? nextSettings.difficulty as RoomSettings['difficulty']
      : 'normal',
    yetiStartMode,
    obstacleVolume: Number(nextSettings.obstacleVolume ?? 1),
  };
}

export class GameController {
  renderer: THREE.WebGLRenderer;
  private menuBackdrop: MenuBackdrop;
  private socket = new SocketClient();
  private currentGame: any = null;
  private playerName = loadSavedPlayerName();
  private playerColor = loadSavedPlayerColor();
  private isMultiplayer = false;
  private roomId: string | null = null;
  private roomSeed: number | null = null;
  private roomPlayers: PlayerStatus[] = [];
  private roomOwnerId: string | null = null;
  private roomSettings: RoomSettings | null = null;
  private roomCountdown: number | null = null;
  private settingsReturnMode: 'title' | 'pause' = 'title';
  private currentRankingEntries: RankingEntry[] = [];
  private listeners = new Set<SnapshotListener>();

  constructor(
    host: HTMLElement,
    private ui: UiAdapter,
    private store: UiStore,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    host.appendChild(this.renderer.domElement);

    this.menuBackdrop = new MenuBackdrop(this.renderer);
    this.bindSocketEvents();
    window.addEventListener('keydown', this.handleShortcutKeys, { capture: true });
    window.addEventListener('keydown', this.handleEscape);
    window.addEventListener('resize', this.handleResize);

    rankingStore.syncFromServer(10);
    this.showTitleScreen();
  }

  subscribe(listener: SnapshotListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ControllerSnapshot {
    const host = this.isRoomHost();
    const countingDown = this.roomCountdown !== null;
    return {
      playerName: this.playerName,
      isMultiplayer: this.isMultiplayer,
      isRoomHost: host,
      settingsReturnMode: this.settingsReturnMode,
      roomSettingsLocked: !host || countingDown,
      roomStartLabel: countingDown
        ? `Starting ${Math.max(0, Math.round(Number(this.roomCountdown) || 0))}`
        : 'Start Game',
      roomStartDisabled: !host || countingDown,
      muted: !!this.currentGame?.audio?.muted,
      muteVisible: !!this.currentGame,
      playerColor: this.playerColor,
    };
  }

  getSocketId() {
    return this.socket.id;
  }

  getPlayerColor() {
    return this.playerColor;
  }

  getSettingsValues(): GameSettings {
    return {
      controlMode: settings.get('controlMode'),
      mouseSensitivity: Number(settings.get('mouseSensitivity')),
      invertMouseY: !!settings.get('invertMouseY'),
      sfxVolume: Number(settings.get('sfxVolume')),
      graphicsQuality: settings.get('graphicsQuality'),
      fogLevel: Number(settings.get('fogLevel')),
      snowVolume: Number(settings.get('snowVolume')),
      obstacleVolume: Number(settings.get('obstacleVolume')),
      gameMode: settings.get('gameMode'),
      difficulty: settings.get('difficulty'),
      yetiStartMode: settings.get('yetiStartMode'),
    };
  }

  savePlayerName(name: string) {
    this.playerName = normalizePlayerName(name);
    try {
      localStorage.setItem(PLAYER_NAME_KEY, this.playerName);
    } catch (e) {
      // Ignore localStorage write failures.
    }
    this.ui.setError('Name saved.');
    this.emit();
    return this.playerName;
  }

  setPlayerNameDraft(name: string) {
    this.playerName = name;
    this.emit();
  }

  startSolo(name: string, gameMode: GameMode) {
    this.playerName = this.persistPlayerName(name);
    this.isMultiplayer = false;
    this.socket.disconnect();
    this.roomId = null;
    this.roomSeed = null;
    settings.set('gameMode', gameMode);
    this.startGame({
      seed: randomSeed(),
      multiplayer: false,
      gameMode,
    });
  }

  createRoom(name: string, gameMode: GameMode) {
    this.playerName = this.persistPlayerName(name);
    this.isMultiplayer = true;
    this.roomSettings = this.getLocalRoomSettings(gameMode);
    this.socket.createRoom(this.playerName, this.roomSettings, (rankingStore as any).playerId, this.playerColor);
    this.emit();
  }

  joinRoom(code: string, name: string) {
    const roomCode = String(code || '').trim().toUpperCase();
    if (!roomCode || roomCode.length < 4) {
      this.ui.setError('Enter a valid room code.');
      return;
    }
    this.playerName = this.persistPlayerName(name);
    this.isMultiplayer = true;
    this.socket.joinRoom(roomCode, this.playerName, (rankingStore as any).playerId, this.playerColor);
    this.emit();
  }

  updatePlayerColor(color: string) {
    this.playerColor = sanitizePlayerColor(color);
    try {
      localStorage.setItem(PLAYER_COLOR_KEY, this.playerColor);
    } catch (e) {
      // Ignore localStorage write failures.
    }
    this.socket.updatePlayerColor(this.playerColor);
    this.emit();
  }

  startRoomGame() {
    this.emit();
    this.socket.startGame();
  }

  leaveRoom() {
    this.socket.leaveRoom();
    this.socket.disconnect();
    this.resetRoomState();
    this.showTitleScreen();
  }

  playAgain() {
    this.destroyCurrentGame();
    if (this.isMultiplayer && this.roomId) {
      this.socket.joinRoom(this.roomId, this.playerName, (rankingStore as any).playerId, this.playerColor);
    } else {
      this.startGame({ seed: randomSeed(), multiplayer: false, gameMode: settings.get('gameMode') });
    }
  }

  mainMenu() {
    this.leaveCurrentGameToMenu();
  }

  openSettings(from: 'title' | 'pause' = 'title') {
    if (from === 'pause' && !this.currentGame?.isPaused) this.pauseCurrentGame();
    this.settingsReturnMode = from;
    this.showSettingsScreen();
    this.emit();
  }

  saveSettingsForm(values: GameSettings) {
    settings.set('controlMode', values.controlMode);
    settings.set('mouseSensitivity', Number(values.mouseSensitivity));
    settings.set('invertMouseY', !!values.invertMouseY);
    settings.set('sfxVolume', Number(values.sfxVolume));
    settings.set('graphicsQuality', values.graphicsQuality);
    settings.set('fogLevel', Number(values.fogLevel));
    settings.set('snowVolume', Number(values.snowVolume));
    settings.set('obstacleVolume', Number(values.obstacleVolume));
    settings.set('gameMode', values.gameMode);
    settings.set('difficulty', values.difficulty);
    settings.set('yetiStartMode', values.yetiStartMode);
    this.currentGame?.audio?.setVolume(settings.get('sfxVolume'));
    this.closeSettings();
  }

  closeSettings() {
    if (this.settingsReturnMode === 'pause' && this.currentGame?.isPaused) {
      this.ui.showPause();
    } else {
      this.settingsReturnMode = 'title';
      this.showTitleScreen();
    }
    this.emit();
  }

  async showRankingScreen() {
    if (this.store.getSnapshot().screen === 'gameover') {
      this.destroyCurrentGame();
    }
    this.menuBackdrop.start();
    this.currentRankingEntries = await rankingStore.syncFromServer(10);
    this.ui.showRanking(this.currentRankingEntries);
    this.emit();
  }

  showRankingOverview() {
    this.ui.showRanking(this.currentRankingEntries);
  }

  async showRankingDetail(playerId: string) {
    const player = await rankingStore.getPlayerSummary(playerId, 10);
    if (player) this.ui.showRankingDetail(player);
  }

  async clearRanking() {
    await rankingStore.clearRemote();
    this.currentRankingEntries = [];
    this.ui.showRanking(rankingStore.getTop(10));
  }

  resumeCurrentGame() {
    this.currentGame?.resume();
    this.emit();
  }

  pauseCurrentGame() {
    if (!this.currentGame?.pause()) return;
    this.ui.showPause();
    this.emit();
  }

  toggleMute() {
    if (!this.currentGame) return;
    this.currentGame.audio.unlock();
    this.currentGame.audio.setMuted(!this.currentGame.audio.muted);
    this.emit();
  }

  updateRoomSettings(nextSettings: Partial<RoomSettings>) {
    if (!this.isRoomHost()) return;
    this.roomSettings = normalizeRoomSettings({ ...this.roomSettings, ...nextSettings });
    this.store.set(current => ({
      ...current,
      room: { ...current.room, settings: this.roomSettings! },
    }));
    this.socket.updateRoomSettings(this.roomSettings);
    this.emit();
  }

  destroy() {
    this.destroyCurrentGame();
    this.menuBackdrop.stop();
    this.socket.disconnect();
    window.removeEventListener('keydown', this.handleShortcutKeys, { capture: true } as any);
    window.removeEventListener('keydown', this.handleEscape);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  private startGame(options: any) {
    this.menuBackdrop.stop();
    this.destroyCurrentGame();
    const gameSocket = options.multiplayer ? this.socket : null;
    this.currentGame = new Game(this.renderer, this.ui, gameSocket, {
      ...options,
      roomSettings: options.multiplayer ? this.roomSettings : null,
      playerName: this.playerName,
      playerId: (rankingStore as any).playerId,
      playerColor: this.playerColor,
      roomId: this.roomId,
      onRunComplete: (result: any) => {
        if (result.multiplayer) return;
        rankingStore.addRemote({
          playerId: (rankingStore as any).playerId,
          name: result.playerName,
          distance: result.distance,
          mode: getRankingMode(result),
          difficulty: result.difficulty,
          date: Date.now(),
        });
      },
    });
    this.currentGame.start();
    this.emit();
  }

  private showTitleScreen() {
    this.menuBackdrop.start();
    this.ui.showTitle();
    this.emit();
  }

  private showSettingsScreen() {
    if (!this.currentGame?.isPaused) this.menuBackdrop.start();
    this.ui.showSettings();
    this.emit();
  }

  private showWaitingScreen(roomId: string, players: PlayerStatus[]) {
    this.menuBackdrop.start();
    this.ui.showWaiting(roomId, players);
    this.ui.updateRoomCountdown(this.roomCountdown);
    this.emit();
  }

  private destroyCurrentGame() {
    if (!this.currentGame) return;
    this.currentGame.destroy();
    this.currentGame = null;
    this.emit();
  }

  private leaveCurrentGameToMenu() {
    this.destroyCurrentGame();
    if (this.isMultiplayer) {
      this.socket.leaveRoom();
      this.socket.disconnect();
    }
    this.resetRoomState();
    this.settingsReturnMode = 'title';
    this.showTitleScreen();
  }

  private resetRoomState() {
    this.roomId = null;
    this.roomSeed = null;
    this.roomPlayers = [];
    this.roomOwnerId = null;
    this.roomSettings = null;
    this.roomCountdown = null;
    this.isMultiplayer = false;
    this.store.set(current => ({
      ...current,
      room: {
        ...current.room,
        roomId: null,
        seed: null,
        players: [],
        ownerId: null,
        countdown: null,
      },
    }));
    this.emit();
  }

  private persistPlayerName(name: string) {
    this.playerName = normalizePlayerName(name);
    try {
      localStorage.setItem(PLAYER_NAME_KEY, this.playerName);
    } catch (e) {
      // Ignore localStorage write failures.
    }
    this.emit();
    return this.playerName;
  }

  private getLocalRoomSettings(gameMode: GameMode): RoomSettings {
    return {
      gameMode,
      difficulty: settings.get('difficulty'),
      yetiStartMode: settings.get('yetiStartMode'),
      obstacleVolume: Number(settings.get('obstacleVolume')),
    };
  }

  private applyRoomSettings(nextSettings: Partial<RoomSettings> = {}) {
    this.roomSettings = normalizeRoomSettings(nextSettings);
    this.store.set(current => ({
      ...current,
      room: { ...current.room, settings: this.roomSettings! },
    }));
    this.emit();
  }

  private syncLocalPlayerColor(players: PlayerStatus[] = []) {
    const local = players.find(player => player.id && player.id === this.socket.id);
    if (!local?.color) return;
    this.playerColor = sanitizePlayerColor(local.color);
    try {
      localStorage.setItem(PLAYER_COLOR_KEY, this.playerColor);
    } catch (e) {
      // Ignore localStorage write failures.
    }
  }

  private setRoomCountdown(remaining: number | null = null) {
    const parsed = remaining === null || remaining === undefined
      ? null
      : Math.max(0, Math.round(Number(remaining) || 0));
    this.roomCountdown = parsed;
    this.ui.updateRoomCountdown(this.roomCountdown);
    this.emit();
  }

  private isRoomHost() {
    return !!this.roomOwnerId && this.roomOwnerId === this.socket.id;
  }

  private bindSocketEvents() {
    this.socket.on('room:created', ({ roomId, seed, players, ownerId, settings: serverSettings, countdown }: any) => {
      this.roomId = roomId;
      this.roomSeed = seed;
      this.roomPlayers = players;
      this.roomOwnerId = ownerId;
      this.syncLocalPlayerColor(players);
      this.applyRoomSettings(serverSettings);
      this.store.set(current => ({
        ...current,
        room: { ...current.room, roomId, seed, players, ownerId },
      }));
      this.showWaitingScreen(roomId, players);
      this.setRoomCountdown(countdown);
    });

    this.socket.on('room:joined', ({ roomId, seed, players, ownerId, settings: serverSettings, countdown }: any) => {
      this.roomId = roomId;
      this.roomSeed = seed;
      this.roomPlayers = players;
      this.roomOwnerId = ownerId;
      this.syncLocalPlayerColor(players);
      this.applyRoomSettings(serverSettings);
      this.store.set(current => ({
        ...current,
        room: { ...current.room, roomId, seed, players, ownerId },
      }));
      this.showWaitingScreen(roomId, players);
      this.setRoomCountdown(countdown);
    });

    this.socket.on('room:state', ({ players, ownerId, settings: serverSettings, countdown }: any) => {
      this.roomPlayers = players;
      this.syncLocalPlayerColor(players);
      if (ownerId) this.roomOwnerId = ownerId;
      if (serverSettings) this.applyRoomSettings(serverSettings);
      if (countdown !== undefined) this.setRoomCountdown(countdown);
      this.ui.updateWaitingPlayers(players);
      this.store.set(current => ({
        ...current,
        room: {
          ...current.room,
          players,
          ownerId: this.roomOwnerId,
        },
      }));
      this.emit();
    });

    this.socket.on('room:countdown', ({ remaining }: any) => {
      this.setRoomCountdown(remaining);
    });

    this.socket.on('room:error', ({ message }: any) => {
      this.ui.setError(message);
      if (!this.roomId && !this.currentGame) {
        this.isMultiplayer = false;
        this.socket.disconnect();
      }
      this.emit();
    });

    this.socket.on('game:start', ({ seed, settings: serverSettings }: any) => {
      this.roomSeed = seed || this.roomSeed;
      if (serverSettings) this.applyRoomSettings(serverSettings);
      this.setRoomCountdown(null);
      this.startGame({
        seed: this.roomSeed,
        multiplayer: true,
        roomSettings: this.roomSettings,
        players: this.roomPlayers,
      });
    });

    this.socket.on('connect', () => {
      if (this.roomId && this.isMultiplayer) {
        this.socket.joinRoom(this.roomId, this.playerName, (rankingStore as any).playerId, this.playerColor);
      }
      this.emit();
    });
  }

  private handleShortcutKeys = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = String(event.key || '').toLowerCase();
    if (!blockedBrowserShortcutKeys.has(key)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.currentGame) return;
    event.preventDefault();

    const screen = this.store.getSnapshot().screen;
    if (this.currentGame._running) this.pauseCurrentGame();
    else if (this.settingsReturnMode === 'pause' && screen === 'settings') this.ui.showPause();
    else this.resumeCurrentGame();
  };

  private handleResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.menuBackdrop.resize(window.innerWidth, window.innerHeight);
    this.currentGame?.resize(window.innerWidth, window.innerHeight);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
