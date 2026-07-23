# Project State Memory

Last updated: 2026-07-23

## Current Game

- SkiFree 3D is a browser game built with Vite, Three.js, Express, and Socket.io.
- The client runs on `localhost:5173`; the server runs on `localhost:3000`.
- Do not run `npm run dev` from automation because the developer runs it manually.

## Recent Fixes

- Restored `client/src/main.js` bootstrap after missing globals caused `inputRoom is not defined`.
- Rebuilt `client/src/game/UI.js` after corrupted/duplicated code caused runtime errors.
- Added missing `#controls-hint` markup and made optional UI display updates null-safe.
- Fixed `Game.js` constants/listeners/class closing issues so the full client bundle builds.
- Spacebar triggers a manual player jump; airborne players pass over normal ground obstacles.
- Keyboard acceleration is available through `S`, down arrow, `Shift`, and `F`; mouse acceleration remains tied to moving the cursor down.

## Graphics and Gameplay Progress

- `graphicsQuality` setting exists with `high` as the default and `low` as the fallback.
- High graphics uses shader snow terrain, gradient sky, layered ridgeline mountains, post-processing, denser layered snow, tone mapping, and richer lighting.
- Visual fog/bloom/exposure were reduced after screenshots showed the first pass was too washed out for gameplay.
- `VisualTerrain.js` keeps shader terrain and CPU-side visual placement aligned while gameplay physics remains on `y = 0`.
- Terrain now communicates downhill motion and snow relief visually without changing multiplayer payloads.
- Obstacles now include holes and rare polar bears.
- Player/ramp jumps now lock trajectory until landing; ramp jump height scales with entry speed.
- Local, remote, and NPC skier models now share a more readable low-poly model with torso, arms, goggles, scarf, skis, and poles.
- Trees, rocks, ramps, holes, and polar bears have stronger procedural silhouettes and snow accents.
- Menu, settings, lobby, game over, HUD, player list, hit flash, speed bar, quality badge, and jump badge were restyled into a more polished arcade UI.
- `MenuBackdrop` renders a lightweight animated 3D snowy scene behind non-game screens.
- `CourseDecor` adds non-collidable flags, gates, and snow stakes for depth and route readability.
- Sky and snow shaders were refined with stable local sky direction, a subtle sun, horizon glow, ridge lighting, and relative-distance snow highlights.
- Fixed `MenuBackdrop` uniform update so the animated menu scene no longer crashes on `uTime.value`.
- Snow density and fog depth were increased slightly after the latest visual tuning request.
- Removed `fog: true` from the custom `MenuBackdrop` shader material; Three.js expects fog uniforms for custom shaders and was throwing during render.
- Hole obstacles are now larger and less regular, with irregular oval, chipped rectangular, and crevasse-like variants plus rotated AABB extents.
- Added persisted `fogLevel` and `snowVolume` settings with sliders in the settings UI.
- New games read `fogLevel` to tune Three.js fog distances and `snowVolume` to scale falling snow particle counts.
- Added procedural part animation to local, remote, and NPC skier rigs: arm/pole swing, leg motion, ski tilt, torso crouch/lean, jump pose, and scarf movement.
- Added procedural gait animation to dogs, polar bears, and yetis: leg steps, bobbing, head motion, tail/ear/body movement where available.
- Added a persisted `difficulty` setting with `easy`, `normal`, `hard`, and `extreme`.
- `YetiManager` now reads difficulty on game creation to tune Yeti trigger distance, chase speed, multiplication interval, and max simultaneous Yetis.
- Added persisted `obstacleVolume` with a 0%-200% settings slider.
- New games pass `obstacleVolume` into `Obstacles`, scaling static obstacles, ramps, holes, NPC skiers, dogs, and capped bear chance.
- Added lightweight avoidance so NPC skiers, dogs, polar bears, and yetis avoid solid generated obstacles instead of moving through them.
- Added deterministic heart pickups to generated chunks; collecting one restores 1 HP up to the 3-heart maximum and pulses the HUD.
- NPC skiers now use deterministic weaving parameters and smooth lateral turns so they ski varied paths instead of straight lines.
- Escape now pauses the active run and shows a pause menu with Resume, Settings, and Main Menu.
- Tree collision now distinguishes jump source: manual jumps still hit trees, while ramp jumps can clear them.
- Restored game audio wiring: Web Audio unlocks on game start, continuous wind/slide loops update per frame, and jump/landing/collision/boost/Yeti/game-over events trigger one-shots.
- Socket connection is now lazy: solo never connects, and multiplayer connects only when creating/joining a room. Leaving a room/run disconnects the client.
- Added fallen tree obstacles as low snowy logs in the static obstacle mix, with rotated AABB collision and avoidance support.
- NPC skiers now vary forward speed over time and periodically enter short zig-zag bursts in addition to their smooth path weaving.
- Added a Yeti radar HUD element fed by local Yeti positions and restored the central blinking Yeti warning when a Yeti is close.
- Moved the Yeti warning to the top of the screen so it no longer blocks the player or central piste.
- Added a local Ranking screen that stores top runs in localStorage and can be opened from the menu or game-over screen.
- Chunk obstacle placement now retries positions and rejects overlapping AABBs, preventing trees and ramps from spawning on top of each other.
- Heart spawning now enforces a 70m minimum distance from other active/generated hearts.
- Added `yetiStartMode` setting with `distance` default and `immediate` mode to start the Yeti chase as soon as a run begins.
- NPC skiers now detect low obstacles ahead and perform short visual jumps over them while continuing to avoid standing trees and ramps.
- Dogs and polar bears can now knock down NPC skiers on collision; knocked NPCs slide briefly before recovering.
- Dog and polar bear gait animation was strengthened with clearer leg lift/reach, body weight shift, head motion, and tail/body movement.
- Dogs, polar bears, and Yetis now jump low obstacles and keep dodging taller blockers through lightweight local AABB checks.
- Horizon mountains were upgraded with denser jagged ridges, irregular snow caps, shaded facets, and low foothill bands while keeping the same procedural Three.js approach.
- Added server-side ranking persistence with SQLite at `server/data/rankings.sqlite`.
- Added REST ranking endpoints and Swagger/OpenAPI docs: `GET/POST/DELETE /api/rankings`, `GET /openapi.json`, and `/docs`.
- Client ranking now syncs with the server API and keeps localStorage as a fallback cache when the API is unavailable.
- Added context-specific fatal collision animations: tumble on rocks/fallen trees, sink into holes, distinct standing-tree impact, and two-skier knockdown when dying against NPC or remote skiers.
- Fixed Yeti radar vertical mapping so threats ahead render toward the top of the scope and Yetis behind render below the player marker.
- Yeti capture now randomly selects one of three stylized death animations: upward launch/fragmentation, lateral corkscrew throw, or ground slam with low-poly parts popping apart.
- Fatal rock/fallen-tree tumbles now use impact speed to drive forward roll distance, roll count, bounce, and loose gear motion; skis, poles, helmet, scarf, and goggles can fly off more aggressively at high speed.
- Dog and polar bear NPC enemies now use seeded mixed movement instead of straight patrol only: straight segments, weaving, zig-zag bursts, small forward/back drift, direction changes, low-obstacle jumps, and AABB dodge steering.
- Death animations were tightened to avoid the skier crossing below the ground; hole deaths now squash/tilt on the surface, and tree/skier/tumble deaths keep extra ground clearance for prone rotations.
- Multiplayer rooms now store shared gameplay settings on the server: game mode, difficulty, Yeti start mode, and obstacle volume. The host edits them in the lobby; guests see them read-only and all clients apply them when the game starts.
- Ranking now stores a persistent browser `playerId`, shows one best entry per player in the general list, and exposes a clickable player detail with total runs plus latest 10 run history.
- Added a main-menu game mode selector with `Classic / Arcade` and `Sky Mario`.
- Added first-pass Sky Mario combat: `E`, `Ctrl`, or left click launches a snowball-style projectile; in multiplayer the server relays compact `combat:throw` events only for Sky Mario rooms.
- Sky Mario projectiles damage/push the local skier when received from another player and can locally knock down visible remote/NPC skiers.
- Ranking mode values now preserve Classic, Multiplayer, Sky Mario, and Multiplayer Sky Mario runs instead of collapsing every non-multiplayer run into `solo`.
- Multiplayer room start now uses a server-side 10-to-0 countdown. The lobby shows `room:countdown`, locks host-editable room settings during the countdown, and starts the run only after the server emits `game:start`.
- In-game controls help is now a persistent bottom HUD panel instead of a short temporary hint. It lists movement, boost, jump, mouse, pause, and Sky Mario throw controls when relevant.
- Multiplayer runs now grant the local skier 5 seconds of spawn invincibility after the game starts. The same Player invincibility path blocks HP loss, skier collisions, and Sky Mario projectile damage, while the HUD shows `Shield Ns`.
- The page now blocks `Ctrl/Cmd+S`, `O`, `A`, `B`, `F`, `P`, `W`, and `Q` in capture phase so browser shortcuts do not interrupt gameplay.
- Multiplayer HUD now shows each room player as `Playing` or `Dead` with current distance.
- When the local multiplayer skier dies, the client stays in the run as spectator, following the highest-distance living remote skier until every player is dead, then opens the final Game Over screen.
- Local and remote skier meshes now render persistent camera-facing name labels above the head using canvas-backed Three.js sprites. Player blink effects keep the label visible.
- Title screen now has a `Save Name` button next to the player name field. The name is stored in localStorage under `skifree3d_player_name`, loaded on page start, and also saved when starting solo or creating/joining multiplayer.
- Multiplayer rooms now reset after all current players emit `player:gameover`: the server marks the run finished, sets `started` back to false, broadcasts `room:state`, and allows the host to start a new countdown. New room runs reset player run state and use a fresh seed.
