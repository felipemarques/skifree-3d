export type ScreenState = 'title' | 'settings' | 'lobby' | 'ranking' | 'game' | 'pause' | 'gameover';

export type GameMode = 'classic' | 'sky_mario';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export type YetiStartMode = 'distance' | 'immediate' | 'disabled';
export type GraphicsQuality = 'low' | 'high';

export interface RoomSettings {
  gameMode: GameMode;
  difficulty: Difficulty;
  yetiStartMode: YetiStartMode;
  obstacleVolume: number;
  difficultyRamp?: boolean;
  skillScoring?: boolean;
}

export interface GameSettings extends RoomSettings {
  controlMode: 'keyboard' | 'mouse' | 'both';
  mouseSensitivity: number;
  invertMouseY: boolean;
  sfxVolume: number;
  graphicsQuality: GraphicsQuality;
  fogLevel: number;
  snowVolume: number;
  touchControls: 'auto' | 'on' | 'off';
}

export interface PlayerStatus {
  id?: string;
  name?: string;
  color?: string;
  distance?: number;
  bonusDistance?: number;
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
  chainCount: number;
  chainRemainingT: number;
  momentum: number;
  cleanStreakSeconds: number;
  yetiDangerT: number;
  avalancheDangerT: number;
  iceGripT: number;
  blizzardT: number;
  pingMs: number | null;
  /** Live in-air trick spin, degrees (0 when grounded or no spin attempted). */
  trickSpinDeg: number;
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
  gameMode: GameMode;
  difficulty: Difficulty;
  multiplayer: boolean;
  ghostSaved: boolean;
  dailyKey: string | null;
}

export interface GhostKeyframe {
  t: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  airborne: boolean;
  speed: number;
}

export interface GhostRunRecord {
  version: 1;
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  obstacleVolume: number;
  difficultyRamp: boolean;
  skillScoring: boolean;
  color: string;
  distance: number;
  recordedAt: number;
  keyframes: GhostKeyframe[];
}

export interface UiAdapter {
  showTitle(): void;
  showSettings(): void;
  showWaiting(roomId: string, players?: PlayerStatus[]): void;
  showGame(state?: Partial<HudState> & { gameMode?: GameMode | string }): void;
  showPause(): void;
  showGameOver(distance: number, scores?: PlayerStatus[], meta?: Partial<Pick<GameOverState, 'gameMode' | 'difficulty' | 'multiplayer' | 'ghostSaved' | 'dailyKey'>>): void;
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
  showNearMissFeedback(bonus?: number): void;
  showJumpChainFeedback(bonus?: number, chainCount?: number): void;
  showUnstuckFeedback(): void;
  showTrickFeedback(bonus?: number, spinDeg?: number): void;
  showTrickFailFeedback(spinDeg?: number): void;
  showLandingPrecisionFeedback(bonus?: number): void;
  showAirClearFeedback(bonus?: number): void;
  showAirBoostFeedback(): void;
  showAvalancheOutrunFeedback(): void;
  showForkBoldLineFeedback(): void;
  setError(message: string): void;
  clearError(): void;
  setNotice(message: string): void;
  setReconnecting(reconnecting: boolean): void;
}

export interface BonusPopup {
  id: number;
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  x: number;
  y: number;
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
  notice: string;
  reconnecting: boolean;
  hitFlashKey: number;
  healFlashKey: number;
  landingFlashKey: number;
  nearMissFlashKey: number;
  jumpChainFlashKey: number;
  unstuckFlashKey: number;
  popups: BonusPopup[];
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
  playerColor: string;
}
