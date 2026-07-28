# SkiFree 3D - Short Software Design Document

Last updated: 2026-07-23

## 1. Purpose

SkiFree 3D is a lightweight browser remake of the classic SkiFree loop: descend an endless snowy slope, avoid obstacles, survive the yeti, and optionally share a deterministic multiplayer room with other players.

Operational memory files live in:

- `memory/project-state.md`
- `memory/decisions.md`
- `memory/next-steps.md`

## 2. Architecture

- Client: Vite + React + Shadcn-style components + Tailwind + Three.js + TypeScript, entrypoint in `client/src/main.tsx`.
- Server: Express + Socket.io + TypeScript, entrypoint in `server/index.ts`, built to `server/dist`.
- Persistence: SQLite ranking database at `server/data/rankings.sqlite`, accessed through `server/RankingRepository.ts`.
- Main loop: `Game` owns scene setup, terrain/chunk updates, player, obstacles, camera, snow, trail, yeti, HUD, and network updates.
- UI loop: React owns menus, settings, lobby, ranking, pause, game over, HUD, and overlays. `GameController` owns app orchestration and `ReactUiAdapter` translates existing imperative game UI calls into React state updates.
- HTTP API: `/health`, `/api/rankings`, `/openapi.json`, and Swagger UI under `/docs`.
- Multiplayer: the client opens a socket only when creating or joining a room. The server owns per-room lobbies, countdowns, room settings, authoritative Classic simulation, and final multiplayer distances.
- Multiplayer Classic is server-authoritative at 30 Hz. The server queues each player's ordered inputs, consumes one valid input per simulation tick, owns HP/distance/death/ranking, and emits volatile `game:snapshot` updates at 30 Hz.
- The authoritative room loop is paced by elapsed wall-clock time, not raw `setInterval` callback count. Delayed Node timers run bounded catch-up ticks so the server cannot progressively fall behind client prediction during a long run.
- The client predicts only fixed `SIM_DT` ticks, sends and records the exact input used for each tick, ignores stale snapshots by `serverTick`, then restores the official state and replays only unacknowledged inputs.
- Local reconciliation uses a decaying visual correction only for meaningful simulation divergence. Remote skiers render from the newest authoritative snapshot with bounded 140 ms extrapolation for a missed packet, avoiding a permanent visual delay between racers.
- Multiplayer Classic treats `player:gameover` from the server as a reliable official death fallback because `game:snapshot` is intentionally volatile for performance.
- Multiplayer rooms own shared gameplay rules: `gameMode`, `difficulty`, `yetiStartMode`, and `obstacleVolume`. The room host can edit these rules in the lobby before start; other players receive them read-only and use them when the run begins.
- Multiplayer rooms also own each player's outfit color. The server assigns and validates unique colors, then broadcasts them in lobby state and authoritative snapshots so every client renders the same player with the same color.
- Multiplayer start is server-counted: when the host starts a room, the server emits `room:countdown` from 10 to 0, locks lobby settings during the countdown, then emits `game:start`.
- Multiplayer HUD keeps a live room status panel with each player marked as playing or dead.
- Multiplayer rooms are reusable: the server marks each player finished on `player:gameover`; when all current room players are finished, the room returns to lobby state and can start another countdown/run.

## 3. Gameplay Systems

- Game mode is selected before a run. `classic` preserves the current arcade descent loop; `sky_mario` keeps the same skiing rules but enables lightweight item combat.
- Player movement supports mouse and keyboard steering, braking, keyboard boost through `S`/down arrow/`Shift`/`F`, Space jump, ramp jumps, HP, invincibility, and unstuck handling.
- In `Both` control mode, any held gameplay key owns movement for that tick; holding boost or brake cannot leave mouse X steering active in the background.
- Multiplayer runs grant the local player 5 seconds of spawn invincibility after `game:start`; damage is ignored during this window and the HUD shows a shield countdown.
- Multiplayer Classic starts players on deterministic shuffled horizontal spawn lanes, far enough apart to avoid immediate skier-skier collisions at the beginning of the run.
- In multiplayer, local death enters spectator mode instead of opening Game Over immediately. The camera follows the best placed living remote skier until every remaining player is dead, then the final room scores are shown.
- Spectator rendering anchors visual terrain to the watched skier so remote players and obstacles stay above the snow while the camera follows another player.
- Spectator camera smoothing resets when the watched target changes, reducing angle differences between dead clients following the same surviving skier.
- Each multiplayer restart resets per-player run state and generates a fresh room seed for the next `game:start`.
- Jump and ramp trajectories are locked until landing; steering and speed input do not change the horizontal path while airborne.
- Ramp jump height scales with entry speed, producing smaller jumps at low speed and higher jumps when boosted.
- Manual ground jumps can clear low hazards such as holes and animals, but tree collision still applies; only ramp jumps clear trees.
- Procedural obstacles and pickups per chunk include standing trees, fallen trees, rocks, stumps, ramps, holes, hearts, polar bears, NPC skiers, and dogs.
- Chunk spawning rejects overlapping obstacle AABBs with padding, so ramps do not spawn under trees or other solids.
- Fallen trees are low solid obstacles with rotated AABB collision; unlike standing trees, they can be cleared by normal jumps.
- Hearts are local deterministic pickups that restore 1 HP up to the 3-heart maximum and show HUD feedback when collected.
- Heart pickup spawning enforces a large minimum spacing between active/generated hearts, so recovery items do not appear clustered.
- Holes are ground obstacles that can be jumped over. Ground collision causes damage, a sharp speed loss, and a short fall/recovery animation.
- Polar bears are rare animated obstacles that patrol laterally, cause normal collision damage, and can be jumped over.
- The Yeti activates after distance progression and ends the run on capture.
- Difficulty controls Yeti pressure: `easy`, `normal`, `hard`, and `extreme` tune activation distance, chase speed, multiplication interval, and maximum simultaneous Yetis. In multiplayer this comes from room settings rather than each player's local settings.
- Local, remote, and NPC skiers use a shared procedural skier rig with animated arms, legs, poles, skis, torso lean, crouch, jump pose, and scarf motion.
- Local and remote player skiers show a camera-facing name label above the head, generated from a lightweight canvas texture and attached to the skier mesh.
- Dogs, polar bears, and yetis use lightweight part-based procedural animation for gait, bobbing, head motion, and body weight shift.
- NPC skiers use deterministic per-skier speed variation, smooth random-looking turns, and periodic zig-zag bursts across the piste, plus lightweight obstacle avoidance against solid AABBs.
- NPC skiers can perform short visual jumps over low hazards such as holes, fallen trees, stumps, rocks, and animals; standing trees and ramps are still avoided.
- Dogs and polar bears can knock down NPC skiers on contact; knocked NPCs slide briefly, then recover into normal skiing.
- Dog and polar bear gaits animate legs, body weight shift, head motion, and tail/ear/body movement with stronger per-leg stride.
- Dogs, polar bears, and yetis use lightweight local obstacle avoidance against solid obstacle AABBs instead of pathfinding.
- Dogs and polar bears mix straight movement, seeded weaving, short zig-zag bursts, small forward/back patrol drift, direction changes, jumps over low blockers, and dodge steering around taller obstacles.
- Enemy NPCs can jump low obstacles such as holes, fallen trees, stumps, and rocks; taller blockers still trigger local dodge/route correction.
- Fatal collisions play a short local death animation before the game-over screen: rocks/fallen trees tumble the skier with forward slide/roll intensity based on impact speed, holes use a squash/tilt fall inside the hole shape, standing trees use a distinct impact fall, and skier-vs-skier deaths knock both visible skiers down.
- Death animations clamp the skier and loose gear above the visual ground plane; hole deaths use squash/tilt into the hole shape instead of pushing the skier through the snow surface.
- Yeti capture uses one of three stylized arcade animations before the game-over screen: upward launch/fragmentation, lateral corkscrew throw, or ground slam with low-poly parts popping apart.
- Sky Mario currently adds snowball-style projectiles fired with `E`, `Ctrl`, or mouse left in solo. Authoritative Sky Mario multiplayer is deferred; rooms using `sky_mario` cannot start until projectile/combat simulation is ported server-side.

## 4. Graphics Systems

- The visual direction is arcade-polished low-poly.
- `graphicsQuality: high` uses `SnowTerrain`, `SkyBg`, `HorizonMountains`, `PostFX`, denser layered snow, improved lights, tone mapping, and richer procedural models.
- `graphicsQuality: low` keeps the simple terrain path, lower snow density, and avoids bloom-heavy rendering.
- `SnowTerrain` adds visual downhill slope and stronger snow relief with shader displacement.
- `VisualTerrain.ts` mirrors the shader height function for local placement of obstacles, ski spray, grooves, and remote players.
- Gameplay physics and collisions still use the stable plane `y = 0`; slope and relief are cosmetic only.
- Mountains are layered ridgeline meshes with parallax/fog depth, jagged snow caps, low foothills, and lightweight shaded facets for more readable background depth.
- `MenuBackdrop` renders a lightweight animated Three.js mountain scene behind title, settings, and lobby screens.
- `CourseDecor` adds non-collidable gates, edge flags, and snow stakes to improve speed/depth reading without changing gameplay.
- The snow shader includes relative-distance lighting and directional ridge shading so the slope stays readable over long runs.

## 5. Settings and Interfaces

- Settings are persisted in localStorage through `client/src/utils/Settings.ts`.
- Player name is persisted separately in localStorage with `skifree3d_player_name`; the title screen has a Save Name button and play/create/join also save the current normalized name.
- `graphicsQuality` accepts `low` or `high`; default is `high`.
- `fogLevel` and `snowVolume` are numeric sliders from `0` to `2`, where `1` preserves the tuned default, lower values reduce the effect, and higher values intensify it.
- `obstacleVolume` is a numeric slider from `0` to `2`, where `1` preserves current obstacle density and higher values spawn more static obstacles, ramps, holes, NPCs, dogs, and a higher capped bear chance.
- `gameMode` accepts `classic` or `sky_mario`; in solo it is selected from the main menu, while multiplayer rooms expose it as a host-controlled lobby setting.
- `difficulty` accepts `easy`, `normal`, `hard`, or `extreme`; default is `normal`.
- `yetiStartMode` accepts `distance`, `immediate`, or `disabled`; `immediate` starts the Yeti chase at the beginning of a run, while `disabled` prevents Yeti warning/capture logic for that run.
- Fog and snowfall are local presentation settings. Obstacle volume is local in solo, but is synchronized as a room rule in multiplayer.
- The menu/HUD use a compact glass-style shell, speed bar, quality badge, jump state badge, multiplayer shield countdown, hit flash, landing feedback, and a persistent controls panel during runs.
- The menu/HUD are React components organized under `client/src/components/screens`, `client/src/components/hud`, and `client/src/components/ui`; Shadcn-style primitives provide buttons, inputs, selects, sliders, cards, badges, and related controls.
- The controls panel lists steering, brake, boost, jump, mouse control, and pause commands; in Sky Mario it also shows throw commands for keyboard and mouse.
- Ranking persists best runs through the server SQLite API and keeps localStorage as a browser cache/fallback when the API is unavailable.
- Ranking stores the played mode as `classic`, `multiplayer`, `sky_mario`, or `multiplayer_sky_mario` so mode-specific runs remain visible in history.
- Each browser gets a persistent `playerId`; the general ranking shows only the best run per player, while clicking a player opens total run count and the latest 10 runs for that player.
- The HUD includes a Yeti radar when threats are nearby, showing relative Yeti positions and nearest distance, while a top-screen blinking warning appears for close danger without covering the player.
- Pressing `Esc` during a run pauses the game and opens a pause menu with Resume, Settings, and Main Menu actions.
- The page blocks browser/editor shortcuts that conflict with gameplay focus: `Ctrl/Cmd+S`, `O`, `A`, `B`, `F`, `P`, `W`, and `Q`.
- Multiplayer lobby shows a shared 10-second countdown before entering gameplay; players can still leave, but settings/start controls are locked while the countdown runs.
- Multiplayer lobby uses a wider desktop panel with players/color selection and room settings side by side, while preserving a stacked layout on small screens.
- Audio is synthesized locally with Web Audio and driven by game events: wind/slide continuous loops, jump, landing, collision, heart loss, boost, Yeti warning, and game-over sounds.
- Multiplayer protocol uses sequenced `player:input` client-to-server and `game:snapshot` server-to-client for authoritative Classic runs. `lastProcessedInputSeq` acknowledges only inputs actually simulated by the server. Legacy `player:update` remains only as a deprecated fallback for non-runtime rooms.
- Room obstacle volume `0` creates no gameplay obstacles or pickups, allowing a genuinely empty multiplayer test track.
- In authoritative Classic, gameplay-critical objects are deterministic from the shared room seed; purely visual decoration may still differ per client until it is moved into shared generation.
- Solo mode does not open a socket connection; leaving a multiplayer lobby/run returns to the main menu and disconnects the client.

## 6. Constraints

- Do not run `npm run dev` in automated work; the developer runs the local dev server.
- Use TypeScript builds and `npm run build` for automated validation.
- React, React DOM, Tailwind, Lucide, and Shadcn-style helper dependencies are part of the client UI layer; gameplay and socket protocol remain unchanged.
- Keep core gameplay and multiplayer protocol stable unless a future design explicitly changes them.

## 7. Next Milestones

- Browser-validate high and low quality modes after a hard reload.
- Tune fog, snow opacity/counts, terrain contrast, and mountain placement from screenshots.
- Browser-test the new menu backdrop and course decoration on desktop and mobile viewports.
- Review obstacle/decor density after holes, bears, gates, and edge flags are played for several chunks.
- Add optional FPS/debug display.
