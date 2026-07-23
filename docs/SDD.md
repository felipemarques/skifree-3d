# SkiFree 3D - Short Software Design Document

Last updated: 2026-07-23

## 1. Purpose

SkiFree 3D is a lightweight browser remake of the classic SkiFree loop: descend an endless snowy slope, avoid obstacles, survive the yeti, and optionally share a deterministic multiplayer room with other players.

Operational memory files live in:

- `memory/project-state.md`
- `memory/decisions.md`
- `memory/next-steps.md`

## 2. Architecture

- Client: Vite + Three.js, entrypoint in `client/src/main.js`.
- Server: Express + Socket.io, entrypoint in `server/index.js`.
- Persistence: SQLite ranking database at `server/data/rankings.sqlite`, accessed through `server/RankingRepository.js`.
- Main loop: `Game` owns scene setup, terrain/chunk updates, player, obstacles, camera, snow, trail, yeti, HUD, and network updates.
- HTTP API: `/health`, `/api/rankings`, `/openapi.json`, and Swagger UI under `/docs`.
- Multiplayer: the client opens a socket only when creating or joining a room. The server owns per-room lobbies, relays room state and player updates, and clients simulate local physics from a shared deterministic seed.
- Multiplayer rooms own shared gameplay rules: `gameMode`, `difficulty`, `yetiStartMode`, and `obstacleVolume`. The room host can edit these rules in the lobby before start; other players receive them read-only and use them when the run begins.
- Multiplayer start is server-counted: when the host starts a room, the server emits `room:countdown` from 10 to 0, locks lobby settings during the countdown, then emits `game:start`.
- Multiplayer HUD keeps a live room status panel with each player marked as playing or dead.
- Multiplayer rooms are reusable: the server marks each player finished on `player:gameover`; when all current room players are finished, the room returns to lobby state and can start another countdown/run.

## 3. Gameplay Systems

- Game mode is selected before a run. `classic` preserves the current arcade descent loop; `sky_mario` keeps the same skiing rules but enables lightweight item combat.
- Player movement supports mouse and keyboard steering, braking, keyboard boost through `S`/down arrow/`Shift`/`F`, Space jump, ramp jumps, HP, invincibility, and unstuck handling.
- Multiplayer runs grant the local player 5 seconds of spawn invincibility after `game:start`; damage is ignored during this window and the HUD shows a shield countdown.
- In multiplayer, local death enters spectator mode instead of opening Game Over immediately. The camera follows the best placed living remote skier until every remaining player is dead, then the final room scores are shown.
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
- Sky Mario currently adds snowball-style projectiles fired with `E`, `Ctrl`, or mouse left. Projectiles arc forward from the skier, can damage/push the local player when received from another multiplayer client, and can knock visible remote/NPC skiers locally.
- In multiplayer Sky Mario, the server relays a compact `combat:throw` socket event only inside rooms whose `gameMode` is `sky_mario`; player position payloads remain unchanged.

## 4. Graphics Systems

- The visual direction is arcade-polished low-poly.
- `graphicsQuality: high` uses `SnowTerrain`, `SkyBg`, `HorizonMountains`, `PostFX`, denser layered snow, improved lights, tone mapping, and richer procedural models.
- `graphicsQuality: low` keeps the simple terrain path, lower snow density, and avoids bloom-heavy rendering.
- `SnowTerrain` adds visual downhill slope and stronger snow relief with shader displacement.
- `VisualTerrain.js` mirrors the shader height function for local placement of obstacles, ski spray, grooves, and remote players.
- Gameplay physics and collisions still use the stable plane `y = 0`; slope and relief are cosmetic only.
- Mountains are layered ridgeline meshes with parallax/fog depth, jagged snow caps, low foothills, and lightweight shaded facets for more readable background depth.
- `MenuBackdrop` renders a lightweight animated Three.js mountain scene behind title, settings, and lobby screens.
- `CourseDecor` adds non-collidable gates, edge flags, and snow stakes to improve speed/depth reading without changing gameplay.
- The snow shader includes relative-distance lighting and directional ridge shading so the slope stays readable over long runs.

## 5. Settings and Interfaces

- Settings are persisted in localStorage through `client/src/utils/Settings.js`.
- Player name is persisted separately in localStorage with `skifree3d_player_name`; the title screen has a Save Name button and play/create/join also save the current normalized name.
- `graphicsQuality` accepts `low` or `high`; default is `high`.
- `fogLevel` and `snowVolume` are numeric sliders from `0` to `2`, where `1` preserves the tuned default, lower values reduce the effect, and higher values intensify it.
- `obstacleVolume` is a numeric slider from `0` to `2`, where `1` preserves current obstacle density and higher values spawn more static obstacles, ramps, holes, NPCs, dogs, and a higher capped bear chance.
- `gameMode` accepts `classic` or `sky_mario`; in solo it is selected from the main menu, while multiplayer rooms expose it as a host-controlled lobby setting.
- `difficulty` accepts `easy`, `normal`, `hard`, or `extreme`; default is `normal`.
- `yetiStartMode` accepts `distance` or `immediate`; `immediate` starts the Yeti chase at the beginning of a run while preserving the selected difficulty tuning.
- Fog and snowfall are local presentation settings. Obstacle volume is local in solo, but is synchronized as a room rule in multiplayer.
- The menu/HUD use a compact glass-style shell, speed bar, quality badge, jump state badge, multiplayer shield countdown, hit flash, landing feedback, and a persistent controls panel during runs.
- The controls panel lists steering, brake, boost, jump, mouse control, and pause commands; in Sky Mario it also shows throw commands for keyboard and mouse.
- Ranking persists best runs through the server SQLite API and keeps localStorage as a browser cache/fallback when the API is unavailable.
- Ranking stores the played mode as `classic`, `multiplayer`, `sky_mario`, or `multiplayer_sky_mario` so mode-specific runs remain visible in history.
- Each browser gets a persistent `playerId`; the general ranking shows only the best run per player, while clicking a player opens total run count and the latest 10 runs for that player.
- The HUD includes a Yeti radar when threats are nearby, showing relative Yeti positions and nearest distance, while a top-screen blinking warning appears for close danger without covering the player.
- Pressing `Esc` during a run pauses the game and opens a pause menu with Resume, Settings, and Main Menu actions.
- The page blocks browser/editor shortcuts that conflict with gameplay focus: `Ctrl/Cmd+S`, `O`, `A`, `B`, `F`, `P`, `W`, and `Q`.
- Multiplayer lobby shows a shared 10-second countdown before entering gameplay; players can still leave, but settings/start controls are locked while the countdown runs.
- Audio is synthesized locally with Web Audio and driven by game events: wind/slide continuous loops, jump, landing, collision, heart loss, boost, Yeti warning, and game-over sounds.
- Socket event payloads and multiplayer protocol are unchanged by the graphics and obstacle pass.
- Solo mode does not open a socket connection; leaving a multiplayer lobby/run returns to the main menu and disconnects the client.

## 6. Constraints

- Do not run `npm run dev` in automated work; the developer runs the local dev server.
- Use `node --check` and `npm run build` for automated validation.
- Avoid new dependencies for this polish pass.
- Keep core gameplay and multiplayer protocol stable unless a future design explicitly changes them.

## 7. Next Milestones

- Browser-validate high and low quality modes after a hard reload.
- Tune fog, snow opacity/counts, terrain contrast, and mountain placement from screenshots.
- Browser-test the new menu backdrop and course decoration on desktop and mobile viewports.
- Review obstacle/decor density after holes, bears, gates, and edge flags are played for several chunks.
- Add optional FPS/debug display.
