const KEY = 'skifree3d_rankings';
const PLAYER_ID_KEY = 'skifree3d_player_id';
const MAX_ENTRIES = 50;
const API_URL = '/api/rankings';
const VALID_MODES = new Set(['solo', 'classic', 'multiplayer', 'sky_mario', 'multiplayer_sky_mario']);

function getOrCreatePlayerId() {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PLAYER_ID_KEY, generated);
    return generated;
  } catch (e) {
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeEntry(entry) {
  const name = String(entry.name || 'Skier').slice(0, 16);
  return {
    id: entry.id,
    playerId: String(entry.playerId || entry.player_id || `legacy:${name.toLowerCase()}`),
    name,
    distance: Math.max(0, Math.round(Number(entry.distance) || 0)),
    mode: VALID_MODES.has(entry.mode) ? entry.mode : 'classic',
    difficulty: String(entry.difficulty || 'normal'),
    date: Number(entry.date) || Date.now(),
    runCount: Math.max(1, Math.round(Number(entry.runCount || entry.run_count) || 1)),
    bestDistance: Math.max(0, Math.round(Number(entry.bestDistance || entry.best_distance || entry.distance) || 0)),
  };
}

function getBestEntriesByPlayer(entries) {
  const bestByPlayer = new Map();
  for (const entry of entries) {
    const current = bestByPlayer.get(entry.playerId);
    if (
      !current ||
      entry.distance > current.distance ||
      (entry.distance === current.distance && entry.date < current.date)
    ) {
      bestByPlayer.set(entry.playerId, entry);
    }
  }
  return Array.from(bestByPlayer.values())
    .sort((a, b) => b.distance - a.distance || a.date - b.date);
}

export class RankingStore {
  constructor() {
    this._entries = [];
    this.playerId = getOrCreatePlayerId();
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this._entries = Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
      this._sortAndTrim();
    } catch (e) {
      this._entries = [];
    }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this._entries));
    } catch (e) {
      // Ignore localStorage write failures.
    }
  }

  _sortAndTrim() {
    this._entries.sort((a, b) => b.distance - a.distance || a.date - b.date);
    this._entries = this._entries.slice(0, MAX_ENTRIES);
  }

  add(entry) {
    const normalized = normalizeEntry(entry);
    if (normalized.distance <= 0) return this.getTop();
    this._entries.push(normalized);
    this._sortAndTrim();
    this._save();
    return this.getTop();
  }

  clear() {
    this._entries = [];
    this._save();
  }

  getTop(limit = 10) {
    return getBestEntriesByPlayer(this._entries).slice(0, limit);
  }

  async syncFromServer(limit = 50) {
    try {
      const res = await fetch(`${API_URL}?limit=${encodeURIComponent(limit)}`);
      if (!res.ok) throw new Error(`Ranking API failed with ${res.status}`);
      const payload = await res.json();
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      this._entries = entries.map(normalizeEntry);
      this._sortAndTrim();
      this._save();
    } catch (e) {
      // Keep localStorage cache when the API is unavailable.
    }

    return this.getTop(limit);
  }

  async addRemote(entry) {
    const normalized = normalizeEntry({
      ...entry,
      playerId: entry.playerId || this.playerId,
    });
    if (normalized.distance <= 0) return this.getTop();

    this._entries.push(normalized);
    this._sortAndTrim();
    this._save();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      });
      if (!res.ok) throw new Error(`Ranking API failed with ${res.status}`);
      const payload = await res.json();
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      if (entries.length) {
        this._entries = entries.map(normalizeEntry);
        this._sortAndTrim();
        this._save();
      }
    } catch (e) {
      // Local cache already contains the run; it can still be shown offline.
    }

    return this.getTop();
  }

  async clearRemote() {
    this.clear();
    try {
      await fetch(API_URL, { method: 'DELETE' });
    } catch (e) {
      // Local cache has been cleared; ignore API failures.
    }
  }

  async getPlayerSummary(playerId, limit = 10) {
    const safePlayerId = String(playerId || '').trim();
    if (!safePlayerId) return null;

    try {
      const res = await fetch(
        `${API_URL}/players/${encodeURIComponent(safePlayerId)}?limit=${encodeURIComponent(limit)}`,
      );
      if (!res.ok) throw new Error(`Ranking API failed with ${res.status}`);
      const payload = await res.json();
      if (payload.player) {
        return {
          ...payload.player,
          history: Array.isArray(payload.player.history)
            ? payload.player.history.map(normalizeEntry)
            : [],
        };
      }
    } catch (e) {
      // Fall back to local cache below.
    }

    const history = this._entries
      .filter(entry => entry.playerId === safePlayerId)
      .sort((a, b) => b.date - a.date)
      .slice(0, limit);
    if (!history.length) return null;
    return {
      playerId: safePlayerId,
      name: history[0].name,
      runCount: this._entries.filter(entry => entry.playerId === safePlayerId).length,
      bestDistance: Math.max(...this._entries
        .filter(entry => entry.playerId === safePlayerId)
        .map(entry => entry.distance)),
      history,
    };
  }
}

export const rankingStore = new RankingStore();
