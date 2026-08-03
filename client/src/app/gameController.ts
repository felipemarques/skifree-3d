import * as THREE from 'three';
import { Game } from '@/game/Game';
import { MenuBackdrop } from '@/game/MenuBackdrop';
import { SocketClient } from '@/net/SocketClient';
import { getDailyKey, getDailySeed } from '@/utils/DailyChallenge';
import { ghostStore } from '@/utils/GhostStore';
import { rankingStore } from '@/utils/RankingStore';
import { settings } from '@/utils/Settings';
import { DEFAULT_PLAYER_COLOR, sanitizePlayerColor } from '../../../shared/AuthoritativeSim';
import type {
  ControllerSnapshot,
  Difficulty,
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
// A little longer than the server's own DISCONNECT_GRACE_MS (server/index.ts)
// so a reconnect attempt that lands right at the edge of the server's window
// still has a chance to succeed before the client gives up on its own.
const RECONNECT_GIVE_UP_MS = 17_000;

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
    difficultyRamp: !!nextSettings.difficultyRamp,
    skillScoring: !!nextSettings.skillScoring,
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
  private isReconnecting = false;
  private reconnectGiveUpHandle: number | null = null;

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
    // The virtual joystick/jump button overlay (Joystick.tsx/TouchControls.tsx)
    // capture their own touches directly, but a stray touch on this canvas
    // itself (outside those elements) should still not scroll/zoom the page.
    this.renderer.domElement.style.touchAction = 'none';
    host.appendChild(this.renderer.domElement);

    this.menuBackdrop = new MenuBackdrop(this.renderer);
    this.bindSocketEvents();
    window.addEventListener('keydown', this.handleShortcutKeys, { capture: true });
    window.addEventListener('keydown', this.handleEscape);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

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

  /**
   * Mode the last completed Daily Challenge ran under, or null. The ranking
   * "Today" tab uses this so it keys off the daily run's mode instead of the
   * player's current settings selection (minor list).
   */
  getLastDailyMode(): GameMode | null {
    const gameOver = this.store.getSnapshot().gameOver;
    return gameOver.dailyKey ? (gameOver.gameMode as GameMode) : null;
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
      difficultyRamp: !!settings.get('difficultyRamp'),
      skillScoring: !!settings.get('skillScoring'),
      touchControls: settings.get('touchControls'),
    };
  }

  savePlayerName(name: string) {
    // Same persistence Play/Create/Join already do silently on every click
    // (see persistPlayerName) - no toast here either, since a name is
    // always saved by the time any play action fires and a dedicated
    // "Name saved." notice made this button look load-bearing when it
    // isn't.
    return this.persistPlayerName(name);
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

  startGhostRace(mode: GameMode, difficulty: Difficulty) {
    const ghost = ghostStore.getBest(mode, difficulty);
    if (!ghost) return;
    this.isMultiplayer = false;
    this.socket.disconnect();
    this.roomId = null;
    this.roomSeed = null;
    settings.set('gameMode', mode);
    this.startGame({
      seed: ghost.seed,
      multiplayer: false,
      gameMode: mode,
      difficulty: ghost.difficulty,
      obstacleVolume: ghost.obstacleVolume,
      difficultyRamp: ghost.difficultyRamp,
      skillScoring: ghost.skillScoring,
      ghostRecord: ghost,
    });
  }

  startDailyChallenge(mode: GameMode) {
    this.isMultiplayer = false;
    this.socket.disconnect();
    this.roomId = null;
    this.roomSeed = null;
    settings.set('gameMode', mode);
    this.startGame({
      seed: getDailySeed(),
      multiplayer: false,
      gameMode: mode,
      difficulty: 'normal',
      obstacleVolume: 1,
      difficultyRamp: true,
      skillScoring: true,
      dailyKey: getDailyKey(),
    });
  }

  createRoom(name: string, gameMode: GameMode) {
    this.playerName = this.persistPlayerName(name);
    this.isMultiplayer = true;
    this.roomSettings = this.getLocalRoomSettings(gameMode);
    this.socket.createRoom(this.playerName, this.roomSettings, (rankingStore as any).playerId, this.playerColor, settings.get('keyTurnSpeed'));
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
    this.socket.joinRoom(roomCode, this.playerName, (rankingStore as any).playerId, this.playerColor, settings.get('keyTurnSpeed'));
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
      this.socket.joinRoom(this.roomId, this.playerName, (rankingStore as any).playerId, this.playerColor, settings.get('keyTurnSpeed'));
      return;
    }
    const gameOver = this.store.getSnapshot().gameOver;
    if (gameOver?.dailyKey) {
      // "Again" from a Daily Challenge replays the same daily (same
      // seed/rules/key), not a fresh random seed (minor list).
      this.startDailyChallenge(gameOver.gameMode || settings.get('gameMode'));
      return;
    }
    this.startGame({ seed: randomSeed(), multiplayer: false, gameMode: settings.get('gameMode') });
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
    settings.set('difficultyRamp', !!values.difficultyRamp);
    settings.set('skillScoring', !!values.skillScoring);
    settings.set('touchControls', values.touchControls);
    this.currentGame?.applySettingsLive(values);
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

  setTouchJump(pressed: boolean) {
    this.currentGame?.input?.setTouchJump(pressed);
  }

  setJoystickVector(x: number, y: number, active: boolean) {
    this.currentGame?.input?.setJoystickVector(x, y, active);
  }

  /**
   * Freezes/unfreezes the simulation without touching the UI screen (unlike
   * pauseCurrentGame/resumeCurrentGame, which navigate to the 'pause'
   * screen). Used by OrientationGate to block a too-narrow portrait aspect
   * without hiding itself the instant it triggers - a screen change to
   * 'pause' would make OrientationGate's own `screen === 'game'` gate go
   * false, disappearing itself and stranding the player on a blank pause
   * screen. Both Game.pause()/resume() are already no-ops if called when
   * already in the requested state, so this is safe to call redundantly.
   */
  setSimulationPaused(paused: boolean) {
    if (!this.currentGame) return;
    if (paused) this.currentGame.pause();
    else this.currentGame.resume();
  }

  /**
   * Mid-race disconnect: freeze the local run (setSimulationPaused, not
   * pauseCurrentGame - same reasoning as OrientationGate, don't navigate to
   * the 'pause' screen) and give socket.io's own auto-reconnect a window to
   * land, instead of tearing the run down on the first dropped packet. The
   * server holds this player's seat for a matching window (see
   * DISCONNECT_GRACE_MS, server/index.ts) - the existing 'connect' handler
   * below already re-fires room:join with the same playerId, which the
   * server recognizes as a resume rather than a fresh join.
   */
  private startReconnecting() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    this.ui.setReconnecting(true);
    this.setSimulationPaused(true);
    this.reconnectGiveUpHandle = window.setTimeout(() => {
      this.reconnectGiveUpHandle = null;
      if (!this.isReconnecting) return;
      this.isReconnecting = false;
      this.ui.setReconnecting(false);
      this.leaveCurrentGameToMenu();
      this.ui.setError('Lost connection to the race.');
      this.emit();
    }, RECONNECT_GIVE_UP_MS);
  }

  /** Successful resume (room:joined with resumed:true) or a hard failure
   * (room:error) both land here to cancel the give-up timer and hide the
   * overlay; only a genuine resume also unpauses the run. */
  private clearReconnecting() {
    if (this.reconnectGiveUpHandle !== null) {
      window.clearTimeout(this.reconnectGiveUpHandle);
      this.reconnectGiveUpHandle = null;
    }
    if (!this.isReconnecting) return;
    this.isReconnecting = false;
    this.ui.setReconnecting(false);
    this.setSimulationPaused(false);
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
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
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
          dailyKey: result.dailyKey || undefined,
        });
        const ghostSaved = result.ghostRecord ? ghostStore.trySave(result.ghostRecord) : false;
        return { ghostSaved };
      },
      onSnapshotTimeout: () => this.handleSnapshotTimeout(),
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

  /**
   * M11 snapshot watchdog: the socket is still connected but authoritative
   * snapshots (volatile emits) have gone silent for SNAPSHOT_TIMEOUT_MS. The
   * server has been driving a run off stale input that long, so the local
   * run is untrustworthy — end it the same way a disconnect would.
   */
  private handleSnapshotTimeout() {
    const screen = this.store.getSnapshot().screen;
    if (screen === 'gameover') return; // already handled by the final snapshot path
    this.leaveCurrentGameToMenu();
    this.ui.setError('Connection lost — your run ended.');
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
      difficultyRamp: false,
      skillScoring: false,
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

    this.socket.on('room:joined', ({ roomId, seed, players, ownerId, settings: serverSettings, countdown, resumed }: any) => {
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
      if (resumed) {
        // Reconnected into a held seat in an already-in-progress race (see
        // startReconnecting) - stay on the current screen and unfreeze the
        // run instead of bouncing to the waiting-room screen a fresh join
        // would normally show.
        this.clearReconnecting();
        this.emit();
        return;
      }
      this.showWaitingScreen(roomId, players);
      this.setRoomCountdown(countdown);
    });

    this.socket.on('room:state', ({ players, ownerId, settings: serverSettings, countdown }: any) => {
      this.roomPlayers = players;
      this.syncLocalPlayerColor(players);
      // A previous owner existing (not just any ownerId) means this is a
      // real migration (e.g. the host disconnected - see GameRoom.removePlayer's
      // Map-insertion-order promotion), not just the room's first ownerId
      // arriving from room:created/room:joined.
      if (ownerId && this.roomOwnerId && ownerId !== this.roomOwnerId) {
        if (ownerId === this.socket.id) {
          this.ui.setNotice('You are now the host.');
        } else {
          const newHost = players.find((p: PlayerStatus) => p.id === ownerId);
          this.ui.setNotice(`${newHost?.name || 'A player'} is now the host.`);
        }
      }
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
      this.clearReconnecting();
      if (this.currentGame) {
        // A room-level error mid-run (e.g. a rejoin attempt rejected after a
        // connection blip) means the server-side run is unreachable — don't
        // keep a zombie local run going (C2).
        this.leaveCurrentGameToMenu();
        this.ui.setError(message || 'Multiplayer run ended.');
      } else if (!this.roomId) {
        this.isMultiplayer = false;
        this.socket.disconnect();
        this.ui.setError(message);
      } else {
        this.ui.setError(message);
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
        this.socket.joinRoom(this.roomId, this.playerName, (rankingStore as any).playerId, this.playerColor, settings.get('keyTurnSpeed'));
      }
      this.emit();
    });

    this.socket.on('disconnect', () => {
      if (!this.isMultiplayer) return;
      const screen = this.store.getSnapshot().screen;

      if (screen === 'gameover') {
        // Run already finished — scores are final and the server already
        // ranked it. Clear the room so "Again" doesn't try a doomed rejoin,
        // and stay on the gameover screen with the results visible.
        this.resetRoomState();
        this.ui.setError('Disconnected from server.');
        this.emit();
        return;
      }

      if (screen === 'game' || screen === 'pause') {
        // Mid-race: the server holds this seat for a grace window instead
        // of ending the run on the first dropped packet (see
        // DISCONNECT_GRACE_MS, server/index.ts) - give socket.io's own
        // auto-reconnect the same window before giving up.
        this.startReconnecting();
        this.emit();
        return;
      }

      // Lobby (not started yet): no run in progress for the server to
      // hold a seat for, so there's nothing to reconnect into - end
      // cleanly and land on the title screen, same as before.
      this.leaveCurrentGameToMenu();
      this.ui.setError('Disconnected from server.');
      this.emit();
    });
  }

  private handleShortcutKeys = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    // Typing in a name/room field keeps browser shortcuts working
    // (Ctrl+W/Q/S/A/F and friends) — same exemption Game.ts's dev-mode
    // guard already has (minor list: Ctrl-block inside text inputs).
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = String(event.key || '').toLowerCase();
    if (!blockedBrowserShortcutKeys.has(key)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /**
   * Tab/window hidden mid-run (alt-tab, tab switch, minimize). The browser
   * throttles the rAF loop to a stop either way, so the only question is
   * whether the freeze is silent or explicit. Solo: pause into the pause
   * screen instead of silently freezing. Multiplayer: the run keeps
   * simulating on the server (inputs go stale and the skier drives straight
   * after ~500ms), so the pause screen's multiplayer warning makes the risk
   * explicit instead of silently handing back a dead run on return. No-op
   * when nothing is running or the game already ended (pauseCurrentGame
   * guards). See C1/M3 in todo/gameplay-scan.md.
   */
  private handleVisibilityChange = () => {
    if (!document.hidden) return;
    this.pauseCurrentGame();
  };

  private handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.currentGame) return;
    event.preventDefault();

    const screen = this.store.getSnapshot().screen;
    if (this.currentGame._running) this.pauseCurrentGame();
    else if (this.settingsReturnMode === 'pause' && screen === 'settings') this.ui.showPause();
    else if (screen === 'pause') this.resumeCurrentGame();
    // Otherwise the sim is frozen with no pause screen showing (e.g. the
    // OrientationGate rotation overlay freezes via setSimulationPaused and
    // leaves the screen on 'game'). Esc must not resume a game the player
    // can't see behind an overlay (M8).
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
