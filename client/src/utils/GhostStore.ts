// @ts-nocheck
const KEY = 'skifree3d_ghosts';
const VALID_MODES = new Set(['classic', 'sky_mario']);
const VALID_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'extreme']);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function normalizeKeyframe(kf) {
  return {
    t: Math.max(0, Math.round(Number(kf?.t) || 0)),
    x: round2(kf?.x),
    y: round2(kf?.y),
    z: round2(kf?.z),
    angle: round3(kf?.angle),
    airborne: !!kf?.airborne,
    speed: round2(kf?.speed),
  };
}

function normalizeRecord(record) {
  const mode = VALID_MODES.has(record?.mode) ? record.mode : 'classic';
  const difficulty = VALID_DIFFICULTIES.has(record?.difficulty) ? record.difficulty : 'normal';
  const keyframes = Array.isArray(record?.keyframes) ? record.keyframes.map(normalizeKeyframe) : [];
  return {
    version: 1,
    mode,
    difficulty,
    seed: Number(record?.seed) || 12345,
    obstacleVolume: Number(record?.obstacleVolume) || 1,
    difficultyRamp: !!record?.difficultyRamp,
    skillScoring: !!record?.skillScoring,
    color: String(record?.color || '#2979ff'),
    distance: Math.max(0, Math.round(Number(record?.distance) || 0)),
    recordedAt: Number(record?.recordedAt) || Date.now(),
    keyframes,
  };
}

function keyFor(mode, difficulty) {
  return `${mode}:${difficulty}`;
}

class GhostStore {
  constructor() {
    this._ghosts = {};
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      this._ghosts = {};
      if (parsed && typeof parsed === 'object') {
        for (const [key, record] of Object.entries(parsed)) {
          if (record?.keyframes?.length) this._ghosts[key] = normalizeRecord(record);
        }
      }
    } catch (e) {
      this._ghosts = {};
    }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this._ghosts));
    } catch (e) {
      // Ignore localStorage write failures.
    }
  }

  getBest(mode, difficulty) {
    return this._ghosts[keyFor(mode, difficulty)] || null;
  }

  trySave(record) {
    if (!record?.keyframes?.length || !(Number(record.distance) > 0)) return false;
    const normalized = normalizeRecord(record);
    const key = keyFor(normalized.mode, normalized.difficulty);
    const existing = this._ghosts[key];
    if (existing && existing.distance >= normalized.distance) return false;
    this._ghosts[key] = normalized;
    this._save();
    return true;
  }
}

export const ghostStore = new GhostStore();
