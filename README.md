# SkiFree 3D Multiplayer

A 3D browser reimagining of the classic 1991 SkiFree game, built with TypeScript, React, Shadcn-style components, Three.js, and real-time multiplayer via [Colyseus](https://www.colyseus.io/).

## Features

### Gameplay
- **3D low-poly graphics** — third-person camera, shader snow, downhill visual relief, layered mountains, standing/fallen trees, rocks, ramps, holes, and polar bears.
- **Classic gameplay** — endless descent with momentum physics, mouse + keyboard controls, jump, speed boost, HP, and heart pickups for recovery.
- **The Yeti** — appears at 2000m and multiplies over time.
- **Yeti mode** — optional setting can start the chase immediately from the beginning of a run or disable the Yeti entirely.
- **Avalanche zones** — time-limited danger events with their own chase speed and proximity bonuses.
- **Fork zones** — branching lane splits with a "Bold Line" scoring bonus for risky lane choice.
- **Biomes** — procedural distance-based biome transitions (forest, alpine, cliffs) with blended lighting, fog, terrain relief, and aurora intensity.
- **Weather system** — deterministic weather zones with blizzards (dense fog/snow), ice patches (reduced grip), and visual telegraphs (StormWall).
- **Wildlife** — dogs, polar bears, and yetis with part-based procedural animation, obstacle avoidance, and NPC interaction.
- **Skill scoring** — optional advanced scoring: near-miss slalom streaks, jump chains with momentum scaling, mid-air tricks (spin detection), clean streak bonuses, yeti/avalanche proximity bonuses, air-clear bonuses, fork Bold Line bonuses, and precision landings.
- **Difficulty ramp** — obstacle density scales with distance during a run.
- **Snowball NPC throwers** — stationary trailside hazards that throw snowballs at approaching players.
- **Ghost players** — solo runs can record and display a ghost of a previous best run.
- **Daily challenges** — daily-key-based ranking categories for competitive play.
- **Sky Mario mode** — lightweight item combat with server-authoritative projectiles (snowballs). Rooms using `sky_mario` are supported in multiplayer.
- **Audio** — synthesized Web Audio driven by game events: wind/slide loops, jump, landing, collision, heart loss, boost, yeti warning, weather shifts, and game-over sounds.

### Multiplayer
- **Colyseus rooms** — up to 8 players per room, server-authoritative Classic mode, real-time state sync, shared procedural mountain seed.
- **Schema-based sync** — Colyseus `@colyseus/schema` (`SimStateSchema` / `PlayerStateSchema` in `shared/RoomStateSchema.ts`) for binary-diff per-tick player state broadcast at 30 Hz, with incremental pickup tracking via `SetSchema`.
- **Reconnection** — mid-race disconnects hold the player's seat for 15 seconds (`allowReconnection`); Colyseus keeps the same `sessionId` across reconnects, so no manual re-keying is needed.
- **Room lobby** — WebSocket connection is opened only when creating or joining a multiplayer room. Short human-shareable room codes (e.g. `A3K9PX`) resolve to Colyseus internal room IDs via `GET /api/rooms/:code/lookup`.
- **Room settings** — host-controlled lobby settings: `gameMode`, `difficulty`, `yetiStartMode`, `obstacleVolume`, `difficultyRamp`, `skillScoring`, `snowballNpcs`.
- **Player colors** — unique color assignment and validation, synchronized across all clients.
- **Manual room disposal** — rooms survive a brief "Play Again" gap (20s empty-room grace) instead of auto-disposing on last player leave.
- **Sky Mario combat** — live server-authoritative projectiles with per-tick hit detection in the authoritative room runtime.
- **Spectator mode** — local death enters spectator mode; camera follows the best living remote skier until all players finish.

### Client
- **React UI** — menus, lobby, settings, ranking, pause, game over, HUD, and overlays as React components with a Shadcn/Tailwind-style arcade glass theme.
- **Colyseus.js adapter** — `SocketClient` wraps `colyseus.js` to expose the same event/method interface the game engine expects, with automatic reconnect logic (6 attempts, 1.8s delay).
- **Graphics quality** — `high` uses shader terrain, layered snow, mountains, sky background, aurora, post-FX bloom, landmarks, course decoration, and wildlife; `low` keeps the lighter terrain path.
- **Gyroscope control** — device-tilt steering on mobile via `DeviceOrientation` with permission handling; dev mode allows I/J/K/L keyboard simulation.
- **Touch controls** — mobile joystick, touch buttons, and orientation gate for portrait/landscape.
- **Menu backdrop** — lightweight animated Three.js mountain scene behind title/settings/lobby screens.
- **Course decoration** — non-collidable gates, edge flags, and snow stakes for speed/depth readability.
- **Impact particles** — ski spray, landing bursts, breath fog, and collision debris.
- **Dev mode** — press `'` to toggle FPS/position/ping overlay and hitbox wireframes; `I/J/K/L` for fake gyro input.

### Server API
- **Rankings** — best-run persisted by the server in SQLite, grouped by player identity, with recent-run history and daily challenge categories.
- **Swagger UI** — available at `http://localhost:3002/docs` when the server is running.

## Controls

| Action | Keyboard | Mouse |
|---|---|---|
| Steer left/right | A/D or left/right arrows | Move mouse left/right |
| Brake | W or up arrow | Move mouse up |
| Accelerate / boost | S, down arrow, Shift, or F | Move mouse down |
| Jump | Space | - |
| Fire (Sky Mario) | E, Ctrl, or left click | Left click |
| Pause | Esc | - |
| Dev mode toggle | ' (apostrophe) | - |
| Fake gyro (dev) | I/J/K/L | - |

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
- Server: http://localhost:3002
- API docs: http://localhost:3002/docs
- OpenAPI JSON: http://localhost:3002/openapi.json

### Production

```bash
npm run build
npm start
```

### Tests

```bash
npm run test:sim
```

Runs the server build and validates the authoritative simulation against shared test fixtures.

## Project Structure

```text
ski-free-3d/
├── client/                          # Vite + React + Three.js frontend
│   ├── src/
│   │   ├── main.tsx
│   │   ├── index.css
│   │   ├── app/
│   │   │   ├── App.tsx             # Root React component & screen routing
│   │   │   ├── GameShell.tsx       # Mounts Three.js canvas + React HUD layer
│   │   │   ├── gameController.ts   # App orchestration (solo/multiplayer state machine)
│   │   │   ├── ReactUiAdapter.ts   # Imperative game UI → React state bridge
│   │   │   └── uiStore.ts          # Centralized React UI state
│   │   ├── components/
│   │   │   ├── screens/            # TitleScreen, LobbyScreen, SettingsScreen,
│   │   │   │                       # RankingScreen, PauseScreen, GameOverScreen,
│   │   │   │                       # HowToPlayScreen, ScreenFrame
│   │   │   ├── hud/                # GameHud, Hearts, SpeedMeter, SpeedLines,
│   │   │   │                       # BonusPopups, HitFlash, LowHealthVignette,
│   │   │   │                       # YetiRadar, PlayerStatusPanel, ControlsPanel,
│   │   │   │                       # Joystick, TouchControls, OrientationGate,
│   │   │   │                       # MuteButton, ReconnectingOverlay
│   │   │   └── ui/                 # Shadcn-style primitives (Button, Card, etc.)
│   │   ├── game/
│   │   │   ├── Game.ts             # Main game loop, scene, subsystem orchestration
│   │   │   ├── Player.ts           # Local player physics, animation, death
│   │   │   ├── RemotePlayer.ts     # Authoritative remote player rendering
│   │   │   ├── GhostPlayer.ts      # Recorded ghost replay
│   │   │   ├── SkierModel.ts       # Procedural skier rig (arms, legs, poles, scarf)
│   │   │   ├── Yeti.ts             # Yeti manager & animation
│   │   │   ├── Terrain.ts          # Base terrain mesh
│   │   │   ├── SnowTerrain.ts      # Shader-based snow terrain with displacement
│   │   │   ├── VisualTerrain.ts    # Cosmetic height function for placement
│   │   │   ├── Obstacles.ts        # Obstacle rendering & chunk generation
│   │   │   ├── HorizonMountains.ts # Layered ridgeline meshes with parallax
│   │   │   ├── Snow.ts             # Snow particle system
│   │   │   ├── SkiTrail.ts         # Ski trail groove rendering
│   │   │   ├── Camera.ts           # Third-person camera with shake & FOV
│   │   │   ├── Input.ts            # Keyboard + mouse + gyro input
│   │   │   ├── GyroControl.ts      # DeviceOrientation with iOS permission
│   │   │   ├── AudioManager.ts     # Synthesized Web Audio
│   │   │   ├── Biome.ts            # Procedural biome blending (forest/alpine/cliffs)
│   │   │   ├── SkyBg.ts            # Gradient sky background
│   │   │   ├── Aurora.ts           # Aurora borealis effect
│   │   │   ├── StormWall.ts        # Oncoming blizzard visual telegraph
│   │   │   ├── ForkWind.ts         # Fork zone wind visual effect
│   │   │   ├── AvalancheEffect.ts  # Avalanche visual effect
│   │   │   ├── CourseDecor.ts      # Gates, edge flags, snow stakes
│   │   │   ├── Landmarks.ts        # Non-collidable scenic landmarks
│   │   │   ├── Wildlife.ts         # Dog/bear procedural animation & AI
│   │   │   ├── PostFX.ts           # Bloom / post-processing
│   │   │   ├── ImpactParticles.ts  # Particle bursts (spray, debris, breath)
│   │   │   └── MenuBackdrop.ts     # Animated mountain scene behind menus
│   │   ├── net/
│   │   │   └── SocketClient.ts     # Colyseus.js adapter with reconnect
│   │   ├── types/
│   │   └── utils/
│   │       ├── Settings.ts         # localStorage-persisted settings
│   │       ├── RankingStore.ts     # Client-side ranking cache / fallback
│   │       ├── DailyChallenge.ts   # Daily challenge key generation
│   │       ├── GhostStore.ts       # Ghost recording persistence
│   │       ├── SeededRandom.ts     # Deterministic RNG
│   │       └── touch.ts            # Touch/pointer helpers
│   ├── components.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── index.html
├── server/                          # Colyseus + Express backend
│   ├── index.ts                    # Express app, Colyseus Server, REST routes
│   ├── SkiRoom.ts                  # Colyseus Room subclass (lobby, countdown,
│   │                               #   player management, settings, game lifecycle)
│   ├── AuthoritativeRoomRuntime.ts # 30 Hz server sim tick loop, input consumption,
│   │                               #   collision, projectile simulation, state sync
│   ├── RankingRepository.ts        # SQLite-backed ranking persistence
│   ├── tsconfig.json
│   ├── package.json
│   └── data/                       # rankings.sqlite (runtime, gitignored)
├── shared/                          # Code shared between client & server
│   ├── AuthoritativeSim.ts         # Deterministic sim: movement, collision, yeti,
│   │                               #   avalanche, projectiles, scoring, obstacles
│   └── RoomStateSchema.ts          # Colyseus schema: SimStateSchema, PlayerStateSchema
├── docs/
│   └── SDD.md                     # Software Design Document
├── scripts/
│   └── check-authoritative-sim.mjs # Sim validation test runner
├── memory/                         # Operational memory files
├── screenshots/
├── package.json                    # Root workspace config
└── README.md
```

## Multiplayer Architecture

- Classic multiplayer is **server-authoritative**: clients send `player:input`, the server simulates movement/collision/HP/distance via `AuthoritativeRoomRuntime` at 30 Hz, and clients render official state updates received through Colyseus schema `broadcastPatch()`.
- The authoritative room runtime writes player fields directly onto Colyseus `SimStateSchema` / `PlayerStateSchema` instances each tick (see `shared/RoomStateSchema.ts`), letting Colyseus's binary-diff protocol handle efficient delta delivery — no hand-rolled snapshot serialization.
- Transient per-tick events (hit/heal/jump-chain/etc.) are sent as a plain `game:events` message just before the schema patch, so they arrive bundled with the player state for that tick.
- Consumed pickup IDs are tracked incrementally via a `TrackingIdSet` that mirrors additions into Colyseus's `SetSchema`, so `broadcastPatch()` only sends newly consumed IDs — no full-set clone per tick.
- The client predicts local movement using the same deterministic `simulatePlayerTick` from `shared/AuthoritativeSim.ts`, reconciles against server snapshots by `serverTick`, and replays only unacknowledged inputs.
- Local reconciliation uses a decaying visual correction for meaningful divergence. Remote skiers render from the newest authoritative snapshot with bounded extrapolation.
- Rooms share a deterministic seed, so gameplay-critical obstacles are generated from the same shared simulation on client and server. A per-room chunk cache (`_chunkCache`) avoids redundant obstacle generation.
- Mid-race disconnects hold the player's seat for 15 seconds via `allowReconnection`. Colyseus preserves the same `sessionId` across reconnects, so no manual re-keying of sim state is needed.
- Multiplayer rankings are recorded from server-authoritative distances; REST ranking writes reject fake multiplayer scores.

## Server API

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/rankings?limit=10` | Best ranking entry per player |
| `GET` | `/api/rankings?dailyKey=YYYY-MM-DD&mode=classic` | Daily challenge rankings |
| `GET` | `/api/rankings/players/:playerId?limit=10` | Player summary with recent history |
| `POST` | `/api/rankings` | Save a score (`name`, `distance`, `mode`, `difficulty`, optional `date`) |
| `DELETE` | `/api/rankings` | Clear all ranking entries |
| `GET` | `/api/rooms/:code/lookup` | Resolve short room code to Colyseus internal room ID |
| `GET` | `/openapi.json` | OpenAPI 3.0 spec |
| `GET` | `/docs` | Swagger UI |

Ranking data is stored in `server/data/rankings.sqlite`, which is generated at runtime and ignored by Git.
