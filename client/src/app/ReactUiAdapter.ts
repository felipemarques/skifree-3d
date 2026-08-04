import type {
  GameMode,
  GameOverState,
  HudState,
  PlayerStatus,
  RankingEntry,
  RankingPlayerSummary,
  UiAdapter,
  UiStoreState,
  YetiThreat,
} from '@/types/app';
import type { UiStore } from './uiStore';

const defaultHud: HudState = {
  distance: 0,
  speed: 0,
  hp: 3,
  isAirborne: false,
  graphicsQuality: 'high',
  spawnShieldSeconds: 0,
  spectatorTarget: '',
  chainCount: 0,
  chainRemainingT: 0,
  momentum: 0,
  cleanStreakSeconds: 0,
  yetiDangerT: 0,
  avalancheDangerT: 0,
  iceGripT: 0,
  blizzardT: 0,
  pingMs: null,
  trickSpinDeg: 0,
};

function asGameMode(value: string | undefined): GameMode {
  return value === 'sky_mario' ? 'sky_mario' : 'classic';
}

export class ReactUiAdapter implements UiAdapter {
  private errorTimer = 0;
  private noticeTimer = 0;
  private controlsTimer = 0;
  private popupSeq = 0;

  constructor(private store: UiStore) {}

  showTitle() {
    this.clearTransient();
    this.store.set(state => ({ ...state, previousScreen: state.screen, screen: 'title', error: '' }));
  }

  showSettings() {
    this.clearTransient();
    this.store.set(state => ({ ...state, previousScreen: state.screen, screen: 'settings', error: '' }));
  }

  showWaiting(roomId: string, players: PlayerStatus[] = []) {
    this.clearTransient();
    this.store.set(state => ({
      ...state,
      previousScreen: state.screen,
      screen: 'lobby',
      error: '',
      room: {
        ...state.room,
        roomId,
        players,
        countdown: null,
      },
    }));
  }

  showGame(state: Partial<HudState> & { gameMode?: GameMode | string } = {}) {
    window.clearTimeout(this.controlsTimer);
    this.store.set(current => ({
      ...current,
      previousScreen: current.screen,
      screen: 'game',
      error: '',
      gameMode: asGameMode(state.gameMode),
      hud: {
        ...current.hud,
        ...state,
        spectatorTarget: state.spectatorTarget ?? current.hud.spectatorTarget ?? '',
      },
      controlsNotice: '',
    }));
  }

  showPause() {
    this.clearTransient();
    this.store.set(state => ({ ...state, previousScreen: state.screen, screen: 'pause', error: '' }));
  }

  showGameOver(distance: number, scores: PlayerStatus[] = [], meta: Partial<Pick<GameOverState, 'gameMode' | 'difficulty' | 'multiplayer' | 'ghostSaved' | 'dailyKey'>> = {}) {
    this.clearTransient();
    this.store.set(state => ({
      ...state,
      previousScreen: state.screen,
      screen: 'gameover',
      error: '',
      gameOver: {
        distance,
        scores,
        gameMode: meta.gameMode ?? 'classic',
        difficulty: meta.difficulty ?? 'normal',
        multiplayer: !!meta.multiplayer,
        ghostSaved: !!meta.ghostSaved,
        dailyKey: meta.dailyKey ?? null,
      },
      playerList: [],
      yetiWarning: false,
      yetiThreats: [],
    }));
  }

  showRanking(entries: RankingEntry[] = []) {
    this.clearTransient();
    this.store.set(state => ({
      ...state,
      previousScreen: state.screen,
      screen: 'ranking',
      error: '',
      rankingEntries: entries,
      rankingDetail: null,
    }));
  }

  showRankingDetail(player: RankingPlayerSummary | null) {
    this.store.set({ rankingDetail: player });
  }

  updateHUD(distance: number, speed: number, hp: number, state: Partial<HudState> = {}) {
    this.store.set(current => ({
      ...current,
      hud: {
        ...current.hud,
        ...state,
        distance,
        speed,
        hp,
        isAirborne: !!state.isAirborne,
        spectatorTarget: state.spectatorTarget ?? '',
      },
    }));
  }

  updateHearts(hp: number) {
    this.store.set(current => ({ ...current, hud: { ...current.hud, hp } }));
  }

  updateWaitingPlayers(players: PlayerStatus[] = []) {
    this.store.set(current => ({ ...current, room: { ...current.room, players } }));
  }

  updateControlsHint(gameMode: GameMode | string = 'classic', notice = '') {
    this.store.set(state => ({ ...state, gameMode: asGameMode(gameMode), controlsNotice: notice }));
  }

  updateRoomCountdown(remaining: number | null = null) {
    const parsed = remaining === null || remaining === undefined
      ? null
      : Math.max(0, Math.round(Number(remaining) || 0));
    this.store.set(current => ({ ...current, room: { ...current.room, countdown: parsed } }));
  }

  updatePlayerList(players: PlayerStatus[] = []) {
    this.store.set({ playerList: players });
  }

  showYetiWarning(show: boolean) {
    this.store.set({ yetiWarning: show });
  }

  updateYetiRadar(threats: YetiThreat[] = []) {
    this.store.set({ yetiThreats: threats });
  }

  showHitFeedback() {
    this.store.set(state => ({ ...state, hitFlashKey: state.hitFlashKey + 1 }));
  }

  showLandingFeedback() {
    this.flashControls('Clean Landing', 'landingFlashKey', 900, 'positive');
  }

  showHealFeedback() {
    this.flashControls('Health +1', 'healFlashKey', 850, 'positive');
  }

  showNearMissFeedback(bonus = 1.5) {
    this.flashControls(`Near Miss +${bonus.toFixed(1)}m`, 'nearMissFlashKey', 700, 'positive');
  }

  showJumpChainFeedback(bonus = 4, chainCount = 0) {
    const label = chainCount >= 2 ? `Jump Chain x${chainCount} +${bonus.toFixed(0)}m` : `Jump Chain +${bonus.toFixed(0)}m`;
    this.flashControls(label, 'jumpChainFlashKey', 900, 'positive');
  }

  showUnstuckFeedback() {
    this.flashControls('Freed from obstacle', 'unstuckFlashKey', 1100, 'neutral');
  }

  // Reuses jumpChainFlashKey/unstuckFlashKey's flash slots rather than
  // adding new ones - flashControls only ever shows one notice at a time
  // regardless (last one wins), so a distinct key per event type isn't
  // needed for correctness, only the label text is.
  showTrickFeedback(bonus = 0, spinDeg = 0) {
    this.flashControls(`${spinDeg}° Spin! +${bonus.toFixed(0)}m`, 'jumpChainFlashKey', 900, 'positive');
  }

  showTrickFailFeedback(spinDeg = 0) {
    this.flashControls('Bailed!', 'unstuckFlashKey', 700, 'negative');
  }

  showLandingPrecisionFeedback(bonus = 0) {
    this.flashControls(`Clean Landing +${bonus.toFixed(1)}m`, 'landingFlashKey', 800, 'positive');
  }

  showAirClearFeedback(bonus = 0) {
    this.flashControls(`Air Clear +${bonus.toFixed(1)}m`, 'nearMissFlashKey', 700, 'positive');
  }

  showAirBoostFeedback() {
    this.flashControls('Air Boost!', 'jumpChainFlashKey', 700, 'positive');
  }

  showAvalancheOutrunFeedback() {
    this.flashControls('Outran the Avalanche!', 'jumpChainFlashKey', 1100, 'positive');
  }

  showForkBoldLineFeedback() {
    this.flashControls('Bold Line!', 'jumpChainFlashKey', 1000, 'positive');
  }

  setError(message: string) {
    window.clearTimeout(this.errorTimer);
    this.store.set({ error: message });
    this.errorTimer = window.setTimeout(() => this.clearError(), 3000);
  }

  clearError() {
    this.store.set({ error: '' });
  }

  /** Neutral/positive transient toast (e.g. "Name saved.") — deliberately
   *  separate from the red error styling (minor list). */
  setNotice(message: string) {
    window.clearTimeout(this.noticeTimer);
    this.store.set({ notice: message });
    this.noticeTimer = window.setTimeout(() => this.clearNotice(), 3000);
  }

  clearNotice() {
    this.store.set({ notice: '' });
  }

  setReconnecting(reconnecting: boolean) {
    this.store.set({ reconnecting });
  }

  private flashControls(
    notice: string,
    key: 'landingFlashKey' | 'healFlashKey' | 'nearMissFlashKey' | 'jumpChainFlashKey' | 'unstuckFlashKey',
    delay: number,
    tone: 'positive' | 'negative' | 'neutral' = 'positive',
  ) {
    window.clearTimeout(this.controlsTimer);
    this.store.set(state => ({
      ...state,
      controlsNotice: notice,
      [key]: state[key] + 1,
    }) as UiStoreState);
    this.controlsTimer = window.setTimeout(() => {
      this.store.set({ controlsNotice: '' });
    }, delay);
    this.pushPopup(notice, tone);
  }

  /** Floating text that flies up and fades near the player, alongside (not
   * instead of) the static HUD flash banner above - reuses the same label
   * text so a bonus reads as something that just happened at the player
   * rather than only a corner-of-the-eye HUD update. Landing now commonly
   * fires several of these in the same instant (landing/landing-precision/
   * trick/jump-chain can all land on one tick) - each new popup is stacked
   * a line above however many are already showing so they read top-to-
   * bottom instead of piling up illegibly on top of each other.
   */
  private pushPopup(text: string, tone: 'positive' | 'negative' | 'neutral') {
    const id = ++this.popupSeq;
    const x = (Math.random() - 0.5) * 34;
    this.store.set(state => {
      const stackSlot = state.popups.length % 4;
      const y = -stackSlot * 30;
      return { ...state, popups: [...state.popups, { id, text, tone, x, y }] };
    });
    window.setTimeout(() => {
      this.store.set(state => ({ ...state, popups: state.popups.filter(p => p.id !== id) }));
    }, 1150);
  }

  private clearTransient() {
    window.clearTimeout(this.controlsTimer);
    this.store.set({
      playerList: [],
      yetiWarning: false,
      yetiThreats: [],
      controlsNotice: '',
    });
  }
}
