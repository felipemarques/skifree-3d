// @ts-nocheck
// Settings - persisted to localStorage
// controlMode: 'keyboard' | 'mouse' | 'both'
// mouseSensitivity: 0.5 - 2.0
// invertMouseY: bool
// sfxVolume: 0 - 1
// graphicsQuality: 'low' | 'high'
// fogLevel: 0 - 2
// snowVolume: 0 - 2
// obstacleVolume: 0 - 2
// gameMode: 'classic' | 'sky_mario'
// difficulty: 'easy' | 'normal' | 'hard' | 'extreme'
// yetiStartMode: 'distance' | 'immediate' | 'disabled'
// showFPS: bool
// difficultyRamp: bool
// skillScoring: bool
// touchControls: 'auto' | 'on' | 'off'

const KEY = 'skifree3d_settings';

const DEFAULTS = {
  controlMode: 'both',
  mouseSensitivity: 1.0,
  invertMouseY: false,
  mouseDeadzone: 0.08,
  keyTurnSpeed: 1.8,
  graphicsQuality: 'high',
  fogLevel: 1.0,
  snowVolume: 1.0,
  obstacleVolume: 1.0,
  gameMode: 'classic',
  difficulty: 'normal',
  yetiStartMode: 'distance',
  showFPS: false,
  sfxVolume: 0.6,
  difficultyRamp: false,
  skillScoring: false,
  hasSeenTutorial: false,
  touchControls: 'auto',
};

export class Settings {
  constructor() {
    this._data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this._data = { ...DEFAULTS, ...parsed };
      }
    } catch (e) {
      // Ignore invalid localStorage payloads.
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this._data));
    } catch (e) {
      // Ignore localStorage write failures.
    }
  }

  get(key) {
    return this._data[key] ?? DEFAULTS[key];
  }

  set(key, value) {
    this._data[key] = value;
    this.save();
  }

  getAll() {
    return { ...this._data };
  }
}

export const settings = new Settings();
