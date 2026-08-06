import type { UiStoreState } from '@/types/app';

const defaultRoomSettings = {
  gameMode: 'classic' as const,
  difficulty: 'normal' as const,
  yetiStartMode: 'distance' as const,
  obstacleVolume: 1,
};

const initialState: UiStoreState = {
  screen: 'title',
  previousScreen: 'title',
  hud: {
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
  },
  gameMode: 'classic',
  room: {
    roomId: null,
    seed: null,
    players: [],
    ownerId: null,
    settings: defaultRoomSettings,
    countdown: null,
  },
  rankingEntries: [],
  rankingDetail: null,
  rankingLoading: false,
  gameOver: {
    distance: 0,
    scores: [],
    gameMode: 'classic',
    difficulty: 'normal',
    multiplayer: false,
    ghostSaved: false,
    dailyKey: null,
  },
  playerList: [],
  yetiWarning: false,
  yetiThreats: [],
  controlsNotice: '',
  error: '',
  notice: '',
  reconnecting: false,
  hitFlashKey: 0,
  healFlashKey: 0,
  landingFlashKey: 0,
  nearMissFlashKey: 0,
  jumpChainFlashKey: 0,
  unstuckFlashKey: 0,
  popups: [],
};

type Listener = () => void;
type Updater = Partial<UiStoreState> | ((state: UiStoreState) => UiStoreState);

export function createUiStore() {
  let state = initialState;
  const listeners = new Set<Listener>();

  function emit() {
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
    set(next: Updater) {
      state = typeof next === 'function'
        ? next(state)
        : { ...state, ...next };
      emit();
    },
    reset() {
      state = initialState;
      emit();
    },
  };
}

export type UiStore = ReturnType<typeof createUiStore>;
