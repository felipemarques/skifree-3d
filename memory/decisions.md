# Decisions Memory

## Visual Direction

- Use an arcade-polished low-poly look.
- Prefer stable procedural visuals over imported art assets for now.
- Reuse existing modules and Three.js primitives before adding systems or dependencies.
- Keep the screen readable first; fog, bloom, and snow must not hide obstacles in the main reaction zone.
- Menu/lobby/settings can use a lightweight Three.js animated backdrop because it reuses the existing renderer and stops when gameplay begins.
- Course flags, gates, and snow stakes are visual guide elements only; they should not affect collision or scoring.
- Character and animal animation should stay procedural and part-based until imported rigs/assets are explicitly justified.

## Performance Defaults

- Default graphics quality is `high`.
- `low` must remain available for weaker machines and should avoid bloom and high particle counts.
- No new runtime dependencies for the current graphics/obstacle pass.

## Gameplay Boundaries

- Do not change room protocol or multiplayer event shapes during this pass.
- Snow displacement, slope, and relief are visual only; gameplay still treats the ground as `y = 0`.
- Holes and polar bears are deterministic chunk obstacles, not network-synced entities.
- Holes cause damage plus short recovery, not instant game over.
- Polar bears patrol laterally; they are obstacles, not chasing AI.
- While the player is jumping or ramping, horizontal trajectory is locked until landing.
- Ramp jump height depends on current speed at takeoff.
- UI polish can add feedback and readability, but should not add new multiplayer state or change gameplay rules implicitly.
- Fog and snowfall controls are local presentation settings only; they must not affect multiplayer state, collision, seeds, or scoring.
- `fogLevel` and `snowVolume` use `1.0` as the tuned baseline, with `0.0` to `2.0` as the user-adjustable range.
- Animation polish must not change collision extents, AI behavior, socket payloads, or deterministic obstacle spawning.
- Difficulty is currently a local gameplay setting for Yeti pressure only; it does not change socket payloads or obstacle seeds.
- `normal` preserves previous Yeti behavior. Other difficulty levels adjust activation distance, speed, multiplication interval, and maximum Yeti count.
- `obstacleVolume` is a local generation-density multiplier with `1.0` as baseline and `0.0` to `2.0` as range.
- Obstacle volume changes deterministic local chunk contents from the same seed, so multiplayer rooms should use matching settings for identical obstacle density unless a future protocol syncs room rules.
- Enemy/animal obstacle avoidance should stay lightweight: filtered nearby solid AABB checks and steering/reversal, not full pathfinding.
- Heart pickups are deterministic local chunk objects, not socket-synced state. They restore local HP only up to the existing 3-heart cap.
- NPC skier path variation should remain deterministic and cheap: seeded weave amplitude/frequency/bias plus existing AABB avoidance, not random per-frame steering.
- Pause is a local client state. Opening Settings from pause keeps the current run paused and returns to the pause menu after saving/back.
- Jump source matters for collisions: manual jumps are for low hazards, while ramps are required to clear trees.
- Audio remains synthesized locally through Web Audio; no external audio assets or network payloads are needed.
- Multiplayer sockets should be scoped to room/lobby usage. Solo runs keep `socket` null inside `Game` and should not open Socket.io.
- Fallen trees are treated as low solid ground obstacles: NPCs/animals avoid them, grounded players collide with them, and jumps can clear them.
- NPC speed/zig-zag variation remains deterministic per spawned skier using seeded parameters and sine/timer windows, not random per-frame changes.
- Yeti radar is local presentation only, derived from active Yeti meshes; it does not change Yeti AI, scoring, or multiplayer payloads.
- Critical warnings should stay outside the primary player/piste sightline; the Yeti text alert lives near the top edge while radar handles directional detail.
- Ranking is local-only for now: top runs persist in browser localStorage with name, distance, mode, difficulty, and date.
- Obstacle spawn overlap prevention uses deterministic retry attempts with AABB padding, favoring plausible placement over guaranteed exact counts in crowded chunks.
- Heart pickups prioritize spacing over count: if no valid point is found after deterministic retries, that heart spawn is skipped.
- Immediate Yeti mode is a local game setting. It starts the chase at run start but keeps the selected difficulty's speed, multiply interval, and max Yeti count.
- NPC jumping is visual/lightweight inside `Obstacles`: low hazards trigger a short airborne state, while high obstacles still use avoidance.
- Animal-vs-NPC skier collisions are local visual simulation only. They do not affect player HP, scoring, sockets, or deterministic terrain generation.
- Animal gait polish stays part-based and procedural; no rigged assets or animation dependencies are introduced.
- Enemy NPC jumps stay local and procedural: low hazards trigger short vertical lift, while tall obstacles still use cheap avoidance instead of pathfinding.
- Mountain polish should remain procedural and mesh-based for now: parallax layers, facets, snow caps, and foothills are preferred over imported image backdrops.
- Ranking is now server-persisted in SQLite, with localStorage kept only as a resilience/cache fallback for offline API failures.
- Swagger is served from a hand-maintained OpenAPI spec in `server/index.js` to avoid extra route annotation tooling.
- Fatal collision animations are local presentation only; they do not alter socket payloads, scoring, or server state.
- Radar screen-space convention is forward/up and behind/down, matching player intuition rather than raw world positive-Z screen placement.
- Yeti capture should read as arcade slapstick/low-poly fragmentation, not gore; all three variants reuse existing skier mesh parts instead of adding violent assets.
- Ranking identity is browser-local for now: `playerId` is generated in localStorage and sent with scores; the server groups by that id instead of name alone.
- Rock/fallen-tree death animation uses presentation-only impact physics scaled from local speed; it does not change collision damage, scoring, or multiplayer payloads.
- Animal enemy motion remains deterministic and cheap: seeded sine/pulse steering plus nearby AABB checks, not pathfinding or random per-frame decisions.
- Death animation readability takes priority over exact physical contact: prone/rolling poses keep a small visual clearance above the snow to avoid mesh clipping.
- Multiplayer synchronizes gameplay-affecting settings at room level only. Game mode, difficulty, Yeti start mode, and obstacle volume are room rules; graphics quality, fog, snowfall, controls, and audio remain local presentation/input preferences.
- The room host controls room settings before start; if the host leaves, ownership transfers to the next remaining player to avoid stranded lobbies.
- Game modes are represented as `classic` and `sky_mario` for gameplay setup. Multiplayer remains a room/session layer on top of those modes rather than a separate physics fork.
- The first Sky Mario pass uses lightweight snowball projectiles and a compact `combat:throw` relay instead of a fully authoritative combat simulation.
- Sky Mario projectile hits cause damage and pushback, not instant death, to preserve the existing 3-heart arcade pacing.
- Ranking stores mode labels separately from difficulty so Classic, Multiplayer, Sky Mario, and Multiplayer Sky Mario runs can coexist in the same player history.
- Multiplayer countdown is server-side. The host triggers it, room settings lock immediately, `room:countdown` is broadcast to the lobby, and `game:start` remains the only transition into gameplay.
- Controls help should stay visible during gameplay because the game now has more commands than the original arcade loop. Temporary landing/heal feedback may reuse the panel briefly but must restore the command list instead of hiding it.
- Multiplayer spawn invincibility is local and presentation-visible through the HUD. It reuses the existing Player invincibility gate for HP loss and combat damage instead of adding server-authoritative health.
- Browser shortcut blocking is explicit and narrow: capture-phase `Ctrl/Cmd` combos for `S`, `O`, `A`, `B`, `F`, `P`, `W`, and `Q` are prevented, while ordinary gameplay keys remain available.
- Multiplayer death is not an immediate local screen transition. The local client sends its final distance, marks itself dead, and keeps rendering remote players as a spectator until all known room players are dead.
- Spectator target selection is client-side and based on highest distance among living remote players; it does not add a new socket payload or server authority.
- Player name labels are mesh-attached Three.js sprites rather than DOM overlays, so they follow local/remote skier transforms, jumps, camera movement, and spectator mode without extra layout work.
- Player display name is browser-local and independent from ranking `playerId`. Saving the name updates only localStorage/default form state and future run payloads.
- Multiplayer room lifecycle is multi-run. `player:gameover` marks server-side per-player finished state; all-finished rooms return to lobby by clearing `started`, preserving room/settings/host, and resetting per-player run state only when the next countdown starts.

## Local Workflow

- Do not run `npm run dev`; the developer controls the local dev server.
- Use `node --check` and `npm run build` for automated validation.
