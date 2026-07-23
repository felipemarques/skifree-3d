# Next Steps Memory

## Near Term

- Add real TypeScript declarations incrementally and remove `// @ts-nocheck` module by module, starting with settings, rankings, room state, socket payloads, and obstacle records.
- Browser-test the new React/Shadcn-style UI: title, settings, lobby, ranking, pause, game over, HUD, Yeti radar, player list, hit flash, and mute button.
- Consider splitting the larger React controller/UI types further after the migration stabilizes in the browser.
- Browser-test the TypeScript migration with a hard reload after the developer restarts the existing dev server.
- Validate the current graphics/obstacle pass in the browser with a hard reload.
- Confirm `Play Solo` starts without console errors in both `high` and `low`.
- Check that nearby obstacles remain readable by 30-50m with fog and snow enabled.
- Play at least two chunks and tune terrain contrast, snow density, bear rarity, and hole visibility from screenshots.
- Verify Space jump and ramp jump clear holes/bears when timed correctly.
- Verify ramp jumps are visibly smaller at low speed and higher while boosted.
- Confirm keyboard/mouse controls do not steer the player midair.
- Confirm multiplayer still creates/joins rooms and syncs players without payload changes.
- Check that the animated menu backdrop does not keep rendering during active gameplay.
- Tune HUD size/contrast after testing on the user's 1366x768-ish viewport.
- Tune gate/flag density if the track starts feeling visually busy.
- Test `fogLevel` and `snowVolume` at 0%, 100%, and 200% in both graphics quality modes.
- Watch local/remote/NPC skier, dog, polar bear, and yeti animations in motion and tune amplitudes if they look too busy or too subtle.
- Test Yeti difficulty levels and tune `hard`/`extreme` so they feel challenging without immediate unavoidable capture.
- Test `obstacleVolume` at 0%, 100%, and 200%; decide later whether multiplayer rooms should sync this as a room rule.
- Stress-test enemy avoidance with `obstacleVolume` at 200% and verify NPCs/animals do not jitter excessively around dense obstacle clusters.
- Test heart pickup visibility, collection timing, and spawn rate after taking damage in solo and multiplayer rooms.
- Observe NPC skier weaving over several chunks and tune amplitude if they feel too chaotic or too subtle.
- Browser-test the pause flow: Esc pause/resume, Settings from pause, and Main Menu exit during solo and multiplayer.
- Test tree collisions while grounded, during manual jump, and during ramp jump to confirm only ramp jumps clear trees.
- Browser-test audio after a hard reload: start from click, keyboard input, mute toggle, settings volume, pause/resume, and game over.
- Browser-test socket lifecycle: hard reload stays disconnected, solo stays disconnected, create/join room connects, leaving lobby/main menu disconnects, and started rooms reject late joins.
- Test fallen tree readability and collision at multiple rotations, especially at high speed and with obstacle volume above 100%.
- Watch NPC skier speed changes and zig-zag bursts for jitter, obstacle clipping, and readability in dense obstacle chunks.
- Test Yeti radar at each difficulty: first spawn, multiple Yetis, close warning, pause/game over hiding, and mobile layout.
- Verify the top Yeti warning remains readable without covering obstacles or the player on desktop and mobile.
- Test ranking persistence after solo and multiplayer runs, clear action, and mobile layout.
- Test dense obstacle chunks to confirm ramps remain clear of trees/rocks/holes and that retry-skipped spawns do not make high volume feel too sparse.
- Test heart spacing across chunk boundaries and tune the 70m minimum if recovery feels too rare.
- Test Yeti start mode in solo and multiplayer; decide later whether multiplayer rooms should sync this as a room rule.
- Watch NPC jumps over holes/fallen trees/rocks at different speeds and confirm they still avoid standing trees and ramps.
- Test dogs/bears knocking down NPC skiers without excessive jitter, repeated stun-locking, or visible mesh clipping.
- Test dog, bear, and Yeti jumps over low obstacles at high obstacle volume, confirming they still dodge standing trees and ramps without FPS drops.
- Browser-check the upgraded horizon mountains in gameplay and menu screens to tune opacity, height, and fog blending if the background gets too busy.
- Test ranking API from the browser: save a solo run, open Ranking, reload the page, and confirm the same entries come back from SQLite.
- Check Swagger UI at `http://localhost:3000/docs` while the server is running.
- Browser-test fatal deaths against standing trees, rocks, fallen trees, holes, NPC skiers, and remote players to tune animation timing before the game-over screen.
- Confirm Yeti radar orientation in immediate-start mode: first Yeti spawning behind should appear below the player marker.
- Browser-test all three Yeti capture variants to ensure each is readable before the game-over screen and does not look too noisy.
- Test ranking with multiple runs from the same browser/name: the general list should keep one row, and clicking it should show total runs plus the latest 10 runs.
- Browser-test rock/fallen-tree deaths at low and boosted speed to tune tumble distance, gear separation, and camera readability before game over.
- Browser-test dog/bear movement in dense chunks to tune zig-zag amplitude, forward/back drift, and obstacle avoidance jitter.
- Browser-test all death animations on shader terrain to verify the skier/equipment never visibly sink below the snow surface.
- Browser-test multiplayer room settings with two clients: host can edit/start, guest sees read-only settings, and both runs use the same difficulty/Yeti mode/obstacle volume.
- Browser-test Classic solo from the mode selector and confirm it behaves like the current arcade loop.
- Browser-test Sky Mario solo: `E`, `Ctrl`, and left click should launch visible projectiles without affecting normal skiing when not fired.
- Browser-test multiplayer Sky Mario with two clients: host selects the mode in lobby, guest sees it read-only, projectiles appear on the other client, and non-Sky-Mario rooms ignore `combat:throw`.
- Tune Sky Mario projectile cooldown, speed, hitbox, and damage after playtesting.
- Verify ranking entries show the correct mode labels for Classic, Multiplayer, Sky Mario, and Multiplayer Sky Mario.
- Browser-test multiplayer countdown with two clients: host clicks Start, both lobbies show 10 down to 0, settings stay locked, and both clients enter the game together.
- Test joining a room while countdown is already running; the late client should see the current remaining seconds and then receive the same `game:start`.
- Browser-test the persistent controls panel on desktop and mobile, including Classic and Sky Mario, to confirm it does not cover the player, Yeti radar, or critical obstacles.
- Browser-test multiplayer spawn protection: after game start the HUD should show `Shield 5s`, early collisions/projectiles should not remove hearts, and damage should resume after the countdown reaches zero.
- Browser-test blocked shortcuts on Windows/Linux and macOS-style keyboards: `Ctrl/Cmd+S/O/A/B/F/P/W/Q` should not open browser dialogs, search, print, close the tab, or quit while the game page is focused where the browser allows prevention.
- Browser-test multiplayer status/spectator flow with at least two clients: alive/dead status updates, dead local client follows the best living remote skier, and Game Over appears only after all players die or leave.
- Browser-test player name labels in solo, multiplayer, spawn shield blink, jumps, death animations, and spectator camera to confirm labels stay readable above each player.
- Browser-test saved player name: click Save Name, hard reload, confirm the input is restored, then start solo/create/join and verify the name appears above the skier and in ranking payloads.
- Browser-test multiplayer restart: after all players die and return to the lobby, the host Start button should reset from `Starting...` to `Start Game`, show a fresh 10-second countdown, and launch a new run with both clients.

## Candidate Improvements

- Add a compact FPS/debug overlay behind `showFPS`.
- Add landing puffs and a ramp takeoff burst.
- Add a small settings note that graphics quality applies to the next run.
- Review obstacle density after holes and bears are tested in real play.

## Known Constraints

- Multiplayer remains client-side authoritative for movement and collisions.
- Deterministic obstacle generation depends on the shared room seed.
- Visual terrain displacement is cosmetic only.
- The developer runs the dev server; automation should not run `npm run dev`.
- The TypeScript migration currently prioritizes runtime parity; strict typing is a follow-up pass.
