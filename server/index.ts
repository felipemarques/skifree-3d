// @ts-nocheck
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const swaggerUi = require('swagger-ui-express');
const { GameRoom, generateRoomId, sanitizeRoomSettings } = require('./GameRoom');
const { RankingRepository } = require('./RankingRepository');
const { AuthoritativeRoomRuntime } = require('./AuthoritativeRoomRuntime');

const app = express();
const server = http.createServer(app);
const rankings = new RankingRepository();
const MULTIPLAYER_START_COUNTDOWN_SECONDS = 10;

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
  },
};

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

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

// rooms: Map<roomId, GameRoom>
const rooms = new Map();

// playerRooms: Map<socketId, roomId>
const playerRooms = new Map();

// Cleanup empty rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.isEmpty() && now - room.createdAt > 300_000) {
      rooms.delete(id);
    }
  }
}, 60_000);

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('/openapi.json', (req, res) => res.json(openApiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get('/api/rankings', async (req, res, next) => {
  try {
    const entries = await rankings.list(req.query.limit);
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

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'internal server error' });
});

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ---- Create Room ----
  socket.on('room:create', ({ playerName, playerId, playerColor, settings }) => {
    let roomId;
    // Ensure unique ID
    do { roomId = generateRoomId(); } while (rooms.has(roomId));

    const seed = Math.floor(Math.random() * 999999) + 1;
    const room = new GameRoom(roomId, seed, socket.id, sanitizeRoomSettings(settings));
    room.addPlayer(socket.id, playerName, playerId, playerColor);
    rooms.set(roomId, room);
    playerRooms.set(socket.id, roomId);

    socket.join(roomId);
    socket.emit('room:created', {
      roomId,
      seed,
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });
    console.log(`[room] ${roomId} created by ${playerName}`);
  });

  // ---- Join Room ----
  socket.on('room:join', ({ roomId, playerName, playerId, playerColor }) => {
    const room = rooms.get(roomId);
    const prevRoom = playerRooms.get(socket.id);
    if (!room) {
      socket.emit('room:error', { message: `Room "${roomId}" not found.` });
      return;
    }
    if (room.started && prevRoom !== roomId) {
      socket.emit('room:error', { message: 'Room game already started.' });
      return;
    }
    if (room.isFull()) {
      socket.emit('room:error', { message: 'Room is full (max 8 players).' });
      return;
    }

    // Leave previous room if any
    if (prevRoom && prevRoom !== roomId) {
      _leaveRoom(socket, prevRoom);
    }

    room.addPlayer(socket.id, playerName, playerId, playerColor);
    playerRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('room:joined', {
      roomId,
      seed: room.seed,
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });

    // Notify others
    socket.to(roomId).emit('room:state', {
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });
    console.log(`[room] ${playerName} joined ${roomId}`);
  });

  // ---- Player Color ----
  socket.on('player:color', ({ color }) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.updatePlayerColor(socket.id, color)) {
      socket.emit('room:error', { message: 'This color is already taken or the room is starting.' });
      return;
    }
    io.to(roomId).emit('room:state', {
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });
  });

  // ---- Room Settings ----
  socket.on('room:updateSettings', (nextSettings) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.updateSettings(socket.id, nextSettings)) {
      socket.emit('room:error', { message: 'Only the room host can change room settings before the game starts.' });
      return;
    }
    io.to(roomId).emit('room:state', {
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });
  });

  // ---- Leave Lobby/Room ----
  socket.on('room:leave', () => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) _leaveRoom(socket, roomId);
  });

  // ---- Start Game ----
  socket.on('game:start', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (socket.id !== room.ownerId) {
      socket.emit('room:error', { message: 'Only the room host can start the game.' });
      return;
    }
    if (room.settings.gameMode === 'sky_mario') {
      socket.emit('room:error', { message: 'Sky Mario authoritative multiplayer is coming in a later pass. Use Classic for now.' });
      return;
    }
    if (room.started || room.countdownTimer) return;
    _startRoomCountdown(roomId, room);
  });

  // ---- Authoritative player input ----
  socket.on('player:input', (input) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || !room.started || !room.runtime) return;
    room.runtime.handleInput(socket.id, input);
  });

  // ---- Player position update ----
  socket.on('player:update', (state) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.started && room.runtime) return;

    room.updatePlayerState(socket.id, state);

    // Relay to others in room (volatile = no guarantee, that's fine for position)
    socket.volatile.to(roomId).emit('player:update', {
      id: socket.id,
      name: room.players.get(socket.id)?.name,
      ...state,
    });
  });

  // ---- Sky Mario item throw ----
  socket.on('combat:throw', (projectile) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.runtime || room.settings.gameMode !== 'sky_mario') return;
    const safeProjectile = {
      x: Number(projectile?.x) || 0,
      y: Number(projectile?.y) || 0.8,
      z: Number(projectile?.z) || 0,
      vx: Number(projectile?.vx) || 0,
      vy: Number(projectile?.vy) || 0,
      vz: Number(projectile?.vz) || 0,
    };
    socket.volatile.to(roomId).emit('combat:throw', {
      ...safeProjectile,
      ownerId: socket.id,
      ownerName: room.players.get(socket.id)?.name,
    });
  });

  // ---- Game Over ----
  socket.on('player:gameover', ({ distance }) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.started && room.runtime) return;

    const player = room.players.get(socket.id);
    const finishedPlayer = room.markPlayerFinished(socket.id, distance);

    // Broadcast to the others
    socket.to(roomId).emit('player:gameover', {
      id: socket.id,
      name: finishedPlayer?.name,
      distance,
    });
    console.log(`[room] ${finishedPlayer?.name} scored ${Math.round(distance)}m in ${roomId}`);

    if (room.started && room.allPlayersFinished()) {
      _finishRoomRun(roomId, room);
    }
  });

  // ---- Dev-mode latency probe ----
  socket.on('debug:ping', (clientTime, callback) => {
    if (typeof callback === 'function') callback(clientTime);
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const roomId = playerRooms.get(socket.id);
    if (roomId) _leaveRoom(socket, roomId);
  });
});

function _leaveRoom(socket, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.runtime) {
    room.runtime.removePlayer(socket.id);
  }
  room.removePlayer(socket.id);
  playerRooms.delete(socket.id);
  socket.leave(roomId);
  socket.to(roomId).emit('player:left', { id: socket.id });
  if (room.isEmpty()) {
    room.clearCountdown();
    if (room.runtime) {
      room.runtime.stop();
      room.runtime = null;
    }
    rooms.delete(roomId);
    console.log(`[room] ${roomId} closed (empty)`);
  } else {
    if (room.started && room.allPlayersFinished()) {
      _finishRoomRun(roomId, room);
      return;
    }
    io.to(roomId).emit('room:state', {
      players: room.getPlayerList(),
      ownerId: room.ownerId,
      settings: room.settings,
      countdown: room.countdownRemaining,
    });
  }
}

function _startRoomCountdown(roomId, room) {
  room.resetPlayersForRun();
  room.seed = Math.floor(Math.random() * 999999) + 1;
  room.countdownRemaining = MULTIPLAYER_START_COUNTDOWN_SECONDS;
  io.to(roomId).emit('room:countdown', { remaining: room.countdownRemaining });
  io.to(roomId).emit('room:state', {
    players: room.getPlayerList(),
    ownerId: room.ownerId,
    settings: room.settings,
    countdown: room.countdownRemaining,
  });

  room.countdownTimer = setInterval(() => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.isEmpty()) {
      if (currentRoom) currentRoom.clearCountdown();
      return;
    }

    currentRoom.countdownRemaining = Math.max(0, Number(currentRoom.countdownRemaining) - 1);
    io.to(roomId).emit('room:countdown', { remaining: currentRoom.countdownRemaining });

    if (currentRoom.countdownRemaining > 0) return;

    currentRoom.clearCountdown();
    currentRoom.started = true;
    currentRoom.runtime = new AuthoritativeRoomRuntime(io, roomId, currentRoom, rankings, _finishRoomRun);
    currentRoom.runtime.start();
    io.to(roomId).emit('game:start', { seed: currentRoom.seed, settings: currentRoom.settings });
    console.log(`[room] ${roomId} game started`);
  }, 1000);
}

function _finishRoomRun(roomId, room) {
  room.started = false;
  room.clearCountdown();
  if (room.runtime) {
    room.runtime.stop();
    room.runtime = null;
  }
  io.to(roomId).emit('room:state', {
    players: room.getPlayerList(),
    ownerId: room.ownerId,
    settings: room.settings,
    countdown: room.countdownRemaining,
  });
  console.log(`[room] ${roomId} run finished`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SkiFree 3D server running on http://localhost:${PORT}`);
});
