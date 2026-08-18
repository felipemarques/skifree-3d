// @ts-nocheck
const express = require('express');
const http = require('http');
const swaggerUi = require('swagger-ui-express');
const { Server, matchMaker } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { SkiRoom, rankings } = require('./SkiRoom');

const ROOM_NAME = 'ski_room';

const app = express();
const httpServer = http.createServer(app);

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SkiFree 3D Server API',
    version: '1.0.0',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Server health check',
        responses: {
          200: {
            description: 'Server status',
          },
        },
      },
    },
    '/api/rankings': {
      get: {
        summary: 'List best persisted ranking entry per player',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          },
        ],
        responses: {
          200: {
            description: 'Best ranking entries sorted by distance, grouped by player',
          },
        },
      },
      post: {
        summary: 'Create a ranking entry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'distance'],
                properties: {
                  name: { type: 'string', maxLength: 16 },
                  playerId: { type: 'string', maxLength: 64 },
                  distance: { type: 'integer', minimum: 1 },
                  mode: {
                    type: 'string',
                    enum: ['solo', 'classic', 'multiplayer', 'sky_mario', 'multiplayer_sky_mario'],
                  },
                  difficulty: { type: 'string' },
                  date: { type: 'integer', description: 'Unix epoch milliseconds' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created ranking entry plus current top entries' },
          400: { description: 'Invalid score payload' },
        },
      },
      delete: {
        summary: 'Clear all ranking entries',
        responses: {
          204: { description: 'Ranking cleared' },
        },
      },
    },
    '/api/rankings/players/{playerId}': {
      get: {
        summary: 'Get player ranking summary and recent run history',
        parameters: [
          {
            name: 'playerId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        ],
        responses: {
          200: { description: 'Player run count, best distance, and recent history' },
          404: { description: 'Player not found' },
        },
      },
    },
    '/api/rooms/{code}/lookup': {
      get: {
        summary: 'Resolve a short shareable room code to its internal Colyseus room id',
        parameters: [
          {
            name: 'code',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Internal Colyseus roomId for the given code' },
          404: { description: 'No room found for that code' },
        },
      },
    },
  },
};

app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/openapi.json', (req, res) => res.json(openApiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get('/api/rankings', async (req, res, next) => {
  try {
    const { dailyKey, mode, limit } = req.query;
    const entries = dailyKey
      ? await rankings.listDaily(mode, dailyKey, limit)
      : await rankings.list(limit);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

app.get('/api/rankings/players/:playerId', async (req, res, next) => {
  try {
    const player = await rankings.getPlayerSummary(req.params.playerId, req.query.limit);
    if (!player) {
      res.status(404).json({ error: 'player not found' });
      return;
    }
    res.json({ player });
  } catch (err) {
    next(err);
  }
});

app.post('/api/rankings', async (req, res, next) => {
  try {
    if (req.body?.mode === 'multiplayer' || req.body?.mode === 'multiplayer_sky_mario') {
      res.status(400).json({ error: 'multiplayer rankings are recorded by the authoritative server runtime' });
      return;
    }
    const entry = await rankings.add(req.body);
    if (!entry) {
      res.status(400).json({ error: 'distance must be greater than 0' });
      return;
    }

    const entries = await rankings.list(10);
    res.status(201).json({ entry, entries });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/rankings', async (req, res, next) => {
  try {
    await rankings.clear();
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

// Resolves a short shareable room code (what players actually type in) to
// Colyseus's own internal roomId (what client.joinById() needs) - Colyseus's
// own room ids aren't meant to be typed/shared. No separate room registry
// needed on our side: matchMaker.query() already lists every live room by
// name, we just filter by the code we stored via setMetadata in SkiRoom.
app.get('/api/rooms/:code/lookup', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    // matchMaker.query()'s filter only matches top-level IRoomCache fields
    // directly (room[field] !== condition[field]) - it does NOT reach into
    // `metadata` for arbitrary keys despite the TS types suggesting
    // otherwise, so the room code (stored via setMetadata in SkiRoom) has to
    // be filtered here instead of passed as a query condition.
    const rooms = await matchMaker.query({ name: ROOM_NAME });
    const match = rooms.find(room => room.metadata?.code === code);
    if (!match) {
      res.status(404).json({ error: `Room "${code}" not found.` });
      return;
    }
    res.json({ roomId: match.roomId });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'internal server error' });
});

const gameServer = new Server({
  // Colyseus's WebSocketTransport defaults to pingInterval: 3000ms /
  // pingMaxRetries: 2 - it forcibly terminates any client (ws.terminate(),
  // not a graceful close) that fails to respond to its own low-level WS
  // ping/pong heartbeat for 2 consecutive intervals (6s total). This is
  // separate from the app's own debug:ping/pong RTT measurement. A heavy
  // WebGL client (this game's bloom/postFX pass alone was measured at over
  // half of total frame scripting time) can have legitimate multi-second
  // main-thread stalls - GC pauses, a burst of new geometry, tab throttling
  // - during which it's still fully alive, just briefly unresponsive to the
  // heartbeat. 6s was tight enough for that to look identical to a dead
  // connection and get killed outright: the debug:ping RTT climbs each
  // second as the same stall delays it too, then the connection drops for
  // real right as the heartbeat budget runs out - exactly the "ping grows
  // then breaks" symptom reported after sustained boosting. Widening the
  // budget to 5 retries (15s) gives a slow-but-alive client enough room to
  // recover on its own before being treated as dead.
  transport: new WebSocketTransport({ server: httpServer, pingMaxRetries: 5 }),
});
gameServer.define(ROOM_NAME, SkiRoom);

const PORT = process.env.PORT || 3002;
gameServer.listen(PORT).then(() => {
  console.log(`SkiFree 3D server running on http://localhost:${PORT}`);
});
