export type ScreenState = 'title' | 'settings' | 'lobby' | 'ranking' | 'game' | 'pause' | 'gameover';

export type GameMode = 'classic' | 'sky_mario';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export type YetiStartMode = 'distance' | 'immediate';
export type GraphicsQuality = 'low' | 'high';

export interface RoomSettings {
  gameMode: GameMode;
  difficulty: Difficulty;
  yetiStartMode: YetiStartMode;
  obstacleVolume: number;
}

export interface GameSettings extends RoomSettings {
  controlMode: 'keyboard' | 'mouse' | 'both';
  mouseSensitivity: number;
  invertMouseY: boolean;
  sfxVolume: number;
  graphicsQuality: GraphicsQuality;
  fogLevel: number;
  snowVolume: number;
}

export interface PlayerStatus {
  id?: string;
  name?: string;
  distance?: number;
  hp?: number;
  alive?: boolean;
  local?: boolean;
}

export interface RankingEntry {
  id?: number | string;
  playerId: string;
  name: string;
  distance: number;
  mode: string;
  difficulty: string;
  date: number;
  runCount?: number;
  bestDistance?: number;
}

export interface RankingPlayerSummary {
  playerId: string;
  name: string;
  runCount: number;
  bestDistance: number;
  history: RankingEntry[];
}

export interface HudState {
  distance: number;
  speed: number;
  hp: number;
  isAirborne: boolean;
  graphicsQuality: GraphicsQuality | string;
  spawnShieldSeconds: number;
  spectatorTarget: string;
}

export interface YetiThreat {
  dx: number;
  dz: number;
  distance: number;
}

export interface RoomState {
  roomId: string | null;
  seed: number | null;
  players: PlayerStatus[];
  ownerId: string | null;
  settings: RoomSettings;
  countdown: number | null;
}

export interface GameOverState {
  distance: number;
  scores: PlayerStatus[];
}

export interface UiAdapter {
  showTitle(): void;
  showSettings(): void;
  showWaiting(roomId: string, players?: PlayerStatus[]): void;
  showGame(state?: Partial<HudState> & { gameMode?: GameMode | string }): void;
  showPause(): void;
  showGameOver(distance: number, scores?: PlayerStatus[]): void;
  showRanking(entries?: RankingEntry[]): void;
  showRankingDetail(player: RankingPlayerSummary | null): void;
  updateHUD(distance: number, speed: number, hp: number, state?: Partial<HudState>): void;
  updateHearts(hp: number): void;
  updateWaitingPlayers(players?: PlayerStatus[]): void;
  updateControlsHint(gameMode?: GameMode | string, notice?: string): void;
  updateRoomCountdown(remaining?: number | null): void;
  updatePlayerList(players?: PlayerStatus[]): void;
  showYetiWarning(show: boolean): void;
  updateYetiRadar(threats?: YetiThreat[]): void;
  showHitFeedback(): void;
  showLandingFeedback(): void;
  showHealFeedback(): void;
  setError(message: string): void;
  clearError(): void;
}

export interface UiStoreState {
  screen: ScreenState;
  previousScreen: ScreenState;
  hud: HudState;
  gameMode: GameMode;
  room: RoomState;
  rankingEntries: RankingEntry[];
  rankingDetail: RankingPlayerSummary | null;
  gameOver: GameOverState;
  playerList: PlayerStatus[];
  yetiWarning: boolean;
  yetiThreats: YetiThreat[];
  controlsNotice: string;
  error: string;
  hitFlashKey: number;
  healFlashKey: number;
  landingFlashKey: number;
}

export interface ControllerSnapshot {
  playerName: string;
  isMultiplayer: boolean;
  isRoomHost: boolean;
  settingsReturnMode: 'title' | 'pause';
  roomSettingsLocked: boolean;
  roomStartLabel: string;
  roomStartDisabled: boolean;
  muted: boolean;
  muteVisible: boolean;
}
