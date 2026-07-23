// @ts-nocheck
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const MAX_NAME_LENGTH = 16;
const MAX_DIFFICULTY_LENGTH = 16;
const MAX_PLAYER_ID_LENGTH = 64;
const VALID_MODES = new Set(['solo', 'classic', 'multiplayer', 'sky_mario', 'multiplayer_sky_mario']);

function normalizeScore(input = {}) {
  const name = String(input.name || 'Skier').trim().slice(0, MAX_NAME_LENGTH) || 'Skier';
  const playerId = String(input.playerId || input.player_id || `legacy:${name.toLowerCase()}`)
    .trim()
    .slice(0, MAX_PLAYER_ID_LENGTH) || `legacy:${name.toLowerCase()}`;
  const distance = Math.max(0, Math.round(Number(input.distance) || 0));
  const mode = VALID_MODES.has(input.mode) ? input.mode : 'classic';
  const difficulty = String(input.difficulty || 'normal').trim().slice(0, MAX_DIFFICULTY_LENGTH) || 'normal';
  const createdAt = Number(input.date || input.createdAt) || Date.now();

  return { playerId, name, distance, mode, difficulty, createdAt };
}

function mapRow(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    name: row.name,
    distance: row.distance,
    mode: row.mode,
    difficulty: row.difficulty,
    date: row.created_at,
    runCount: row.run_count,
    bestDistance: row.best_distance,
  };
}

class RankingRepository {
  constructor(dbPath = path.join(__dirname, 'data', 'rankings.sqlite')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new sqlite3.Database(dbPath);
    this.ready = this._run(`
      CREATE TABLE IF NOT EXISTS rankings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        distance INTEGER NOT NULL,
        mode TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
      .then(() => this._ensurePlayerIdColumn())
      .then(() => this._run(`
      CREATE INDEX IF NOT EXISTS idx_rankings_distance_created_at
      ON rankings(distance DESC, created_at ASC)
    `))
      .then(() => this._run(`
      CREATE INDEX IF NOT EXISTS idx_rankings_player_created_at
      ON rankings(player_id, created_at DESC)
    `));
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async _ensurePlayerIdColumn() {
    const columns = await this._all('PRAGMA table_info(rankings)');
    const hasPlayerId = columns.some(col => col.name === 'player_id');
    if (!hasPlayerId) {
      await this._run('ALTER TABLE rankings ADD COLUMN player_id TEXT');
    }
    await this._run(`
      UPDATE rankings
      SET player_id = 'legacy:' || lower(name)
      WHERE player_id IS NULL OR player_id = ''
    `);
  }

  async add(input) {
    await this.ready;
    const score = normalizeScore(input);
    if (score.distance <= 0) return null;

    const result = await this._run(
      `
        INSERT INTO rankings (player_id, name, distance, mode, difficulty, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [score.playerId, score.name, score.distance, score.mode, score.difficulty, score.createdAt],
    );

    return { id: result.lastID, ...score, date: score.createdAt };
  }

  async list(limit = 10) {
    await this.ready;
    const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 10)));
    const rows = await this._all(
      `
        SELECT
          r.id,
          r.player_id,
          r.name,
          r.distance,
          r.mode,
          r.difficulty,
          r.created_at,
          c.run_count
        FROM rankings r
        JOIN (
          SELECT player_id, COUNT(*) AS run_count, MAX(distance) AS best_distance
          FROM rankings
          GROUP BY player_id
        ) c ON c.player_id = r.player_id AND c.best_distance = r.distance
        WHERE r.id = (
          SELECT r2.id
          FROM rankings r2
          WHERE r2.player_id = r.player_id
          ORDER BY r2.distance DESC, r2.created_at ASC, r2.id ASC
          LIMIT 1
        )
        ORDER BY r.distance DESC, r.created_at ASC
        LIMIT ?
      `,
      [safeLimit],
    );
    return rows.map(mapRow);
  }

  async getPlayerSummary(playerId, limit = 10) {
    await this.ready;
    const safePlayerId = String(playerId || '').trim().slice(0, MAX_PLAYER_ID_LENGTH);
    if (!safePlayerId) return null;
    const safeLimit = Math.max(1, Math.min(50, Math.round(Number(limit) || 10)));

    const summary = await this._get(
      `
        SELECT
          player_id,
          name,
          COUNT(*) AS run_count,
          MAX(distance) AS best_distance
        FROM rankings
        WHERE player_id = ?
        GROUP BY player_id
      `,
      [safePlayerId],
    );
    if (!summary) return null;

    const rows = await this._all(
      `
        SELECT id, player_id, name, distance, mode, difficulty, created_at
        FROM rankings
        WHERE player_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      [safePlayerId, safeLimit],
    );

    return {
      playerId: summary.player_id,
      name: summary.name,
      runCount: summary.run_count,
      bestDistance: summary.best_distance,
      history: rows.map(mapRow),
    };
  }

  async clear() {
    await this.ready;
    await this._run('DELETE FROM rankings');
  }
}

module.exports = {
  RankingRepository,
  normalizeScore,
};
