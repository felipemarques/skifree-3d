# SkiFree 3D Multiplayer

A 3D browser reimagining of the classic 1991 SkiFree game, built with Three.js and real-time multiplayer via Socket.io.

## Features

- **3D low-poly graphics** - third-person camera, shader snow, downhill visual relief, layered mountains, standing/fallen trees, rocks, ramps, holes, and polar bears.
- **Classic gameplay** - endless descent with momentum physics, mouse + keyboard controls, jump, speed boost, HP, and heart pickups for recovery.
- **The Yeti** - appears at 2000m and multiplies over time.
- **Yeti mode** - optional setting can start the chase immediately from the beginning of a run.
- **Multiplayer** - up to 8 players per room, real-time position sync, shared procedural mountain seed.
- **Room lobby** - socket connection is opened only when creating or joining a multiplayer room.
- **Ranking** - best-run screen persisted by the server in SQLite, grouped by player identity, with recent-run history per player and browser cache fallback.
- **Server API docs** - Swagger UI is available at `http://localhost:3000/docs` when the server is running.
- **Graphics quality** - `high` uses shader terrain, layered snow, mountains, and bloom; `low` keeps the lighter terrain path.

## Controls

| Action | Keyboard | Mouse |
|---|---|---|
| Steer left/right | A/D or left/right arrows | Move mouse left/right |
| Brake | W or up arrow | Move mouse up |
| Accelerate / boost | S, down arrow, Shift, or F | Move mouse down |
| Jump | Space | - |
| Pause | Esc | - |

Jump trajectory is locked until landing. Ramp jump height scales with entry speed, so slow ramps produce smaller jumps and boosted ramps launch higher.

## Running Locally

### Requirements

- Node.js 18+

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000
- API docs: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Production

```bash
npm run build
npm start
```

## Project Structure

```text
skyfree-3d/
|-- client/
|   |-- src/
|   |   |-- main.js
|   |   |-- game/
|   |   |   |-- Game.js
|   |   |   |-- Player.js
|   |   |   |-- RemotePlayer.js
|   |   |   |-- SkierModel.js
|   |   |   |-- Yeti.js
|   |   |   |-- Terrain.js
|   |   |   |-- SnowTerrain.js
|   |   |   |-- VisualTerrain.js
|   |   |   |-- Obstacles.js
|   |   |   |-- HorizonMountains.js
|   |   |   |-- Snow.js
|   |   |   |-- SkiTrail.js
|   |   |   |-- Camera.js
|   |   |   |-- Input.js
|   |   |   `-- UI.js
|   |   |-- net/
|   |   `-- utils/
|   `-- index.html
`-- server/
```

## Multiplayer Architecture

- Position updates run at 20 Hz.
- Rooms share a deterministic seed, so terrain and obstacles are generated locally without per-obstacle network sync.
- Player physics and collisions are client-side for this MVP.
- Socket payloads are unchanged by the graphics and obstacle polish pass.

## Server API

- `GET /health` - health check and active room count.
- `GET /api/rankings?limit=10` - list each player's best persisted ranking entry.
- `GET /api/rankings/players/:playerId?limit=10` - show total runs and recent history for one player.
- `POST /api/rankings` - save a score with `name`, `distance`, `mode`, `difficulty`, and optional `date`.
- `DELETE /api/rankings` - clear all ranking entries.

Ranking data is stored in `server/data/rankings.sqlite`, which is generated at runtime and ignored by Git.
