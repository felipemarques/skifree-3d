# Gameplay Scan — Issues & Friction

Scan date: 2026-07-31. Sources: direct read of core gameplay systems (Input, Player, Game loop,
Obstacles, Yeti, Camera, shared/AuthoritativeSim) + verified sweeps of UI/UX and multiplayer/net layers.

Severity: 🔴 critical · 🟠 major · 🟡 minor · ⚪ nit.

---

## 🔴 Critical

### C1. No auto-pause on tab blur + held keys never cleared → stuck inputs / dead multiplayer runs
- `client/src/game/Input.ts:40-58` — only `keydown`/`keyup` handlers; nothing clears `this.keys` on window
  `blur`/`visibilitychange`. Alt-tab while holding Space/Shift/WASD leaves jump/boost/steer permanently held
  for the rest of the run.
- No `visibilitychange` handler exists anywhere in the client (grep = 0 matches). Solo: tabbing away silently
  freezes the rAF loop with no pause screen. Multiplayer: the server keeps simulating while the client is
  frozen (`server/AuthoritativeRoomRuntime.ts` replays stale/neutral input for 500ms, then drives the skier
  straight at BASE_SPEED 14 into whatever's ahead).

Fix direction:
- `Input.ts`: add `window.addEventListener('blur', …)` clearing `this.keys`, `_touchJumpHeld`, joystick state.
- `Game.ts`/`gameController.ts`: on `document.visibilitychange` → hidden: pause solo runs; in multiplayer
  either pause input streaming or surface a "run still live on server" warning.

### C2. Multiplayer disconnect = immortal, unending local run
- `client/src/app/gameController.ts` `bindSocketEvents()` (573-653) has no `disconnect` handler. `SocketClient`
  emits it; nothing listens.
- `client/src/game/Game.ts:1268-1275`: prediction revives the player on every predicted death
  (`state.alive = true`, `hp = max(1, hp)`) while `_authLocalSnapshotAlive` stays `true`. With no snapshots
  arriving, the player can never die.
- Reconnect → server rejects ("Room game already started.", `server/index.ts:242`); `room:error` handler
  (`gameController.ts:626-633`) only tears down when `!roomId && !currentGame`, so the error is swallowed and
  the zombie run continues indefinitely.

Fix direction: listen for `'disconnect'` → end the run cleanly (submit nothing, show game-over/leave);
add a mid-run rejoin path or force a controlled exit; make `room:error` recover even when a game is active.

---

## 🟠 Major

### M1. Joystick steering is mirrored — knob moves right, skier goes left
- `client/src/components/hud/Joystick.tsx:25` reports `-dx / MAX_RADIUS` (X negated) while the knob renders at
  `center.x + knob.x` (line 97). Keyboard right is `+1` (`Input.ts:106`), mouse right is `+1` (`Input.ts:148`).
  Y is *not* negated — inconsistent. Touch steers opposite of every other input and of the visible knob.

Fix: remove the `-` on X in `Joystick.tsx:25` (`setJoystickVector(dx / MAX_RADIUS, -dy / MAX_RADIUS, true)`).

### M2. Multiplayer hitboxes don't match the rendered obstacles
- Client visuals use a different RNG stream than the authoritative hitboxes:
  `client/src/game/Obstacles.ts:1133-1148` calls `generateGameplayChunk(authoritativeSeed, …)` for collision
  records but builds meshes from a separate `SeededRandom` (e.g. `makeTree` draws its own random scale
  0.78–1.45, `Obstacles.ts:244`). Sim tree halfW comes from its own independent draw
  (`shared/AuthoritativeSim.ts:369`).
- Result: visually small tree with large invisible hitbox (hit by "thin air"); big tree fully clippable;
  holes collide as unrotated `width*0.62` boxes (`AuthoritativeSim.ts:392-397`) while visuals rotate randomly;
  hearts: sim hitbox 0.34 (`sim:388`) vs visual 0.46 (`Obstacles.ts:673`) — touch a heart visually, don't
  collect it. Solo is immune (hitbox == mesh).

Fix direction: derive visual mesh scale from the sim record (pass `halfW/halfD`/scale into the mesh makers),
or have the sim emit the visual params so client meshes match bit-for-bit.

### M3. Pausing in multiplayer is a death sentence
- `Game.pause()/resume()` (`client/src/game/Game.ts:643-662`) have no multiplayer guard. Esc → rAF stops →
  inputs stop → server keeps the skier moving straight at 14 u/s into obstacles. No warning, no server-side
  "paused" signal. Same for tab-out and frame stalls >500ms.

Fix direction: server-side pause request (`room:pause` gating input consumption), or client keeps sending
neutral input + warning overlay while paused.

### M4. `keyTurnSpeed` setting silently ignored in multiplayer
- Solo: `client/src/game/Player.ts:256-261` uses `settings.get('keyTurnSpeed')` (default 1.8). MP: shared sim
  always uses fixed `PLAYER_TURN_RATE = 1.8` (`shared/AuthoritativeSim.ts:13`). Solo-tuned players get a
  different-feeling game in MP with no indication.

### M5. Mid-run settings changes silently don't apply
- `gameController.saveSettingsForm` (`client/src/app/gameController.ts:311-328`) only pushes `sfxVolume` to the
  live game. Graphics quality, fog, snow, obstacle volume, difficulty, yeti mode are read once at Game
  construction (`Game.ts:168-186`) and never re-applied; HUD badge keeps showing the stale quality
  (`client/src/components/hud/GameHud.tsx:31`). Settings is reachable from pause (implying "adjust now") and
  the common reason to open it mid-run (fix frame rate) does nothing.

Fix direction: apply live where cheap (fog density, snow intensity, graphics-level toggles) or add a
"applies on next run" note in the settings UI.

### M6. Ranking "Clear" wipes the global leaderboard with no confirmation
- `client/src/components/screens/RankingScreen.tsx:95-97` → `clearRemote()` → `DELETE /api/rankings`
  (all players' scores). One mis-tap destroys everything; no confirm dialog, no undo.

### M7. Sky Mario multiplayer is a dead-end the lobby never warns about
- `client/src/components/screens/LobbyScreen.tsx:96-99` offers Sky Mario; host Start is enabled. Server rejects
  at start (`server/index.ts:331-334`). Only recovery is the error toast + manual mode change.

Fix: disable/annotate Sky Mario in the lobby (match `docs/SDD.md` "deferred" status).

### M8. Esc while the OrientationGate overlay is up resumes a frozen game behind it
- `setSimulationPaused(true)` (`gameController.ts:401-405`) freezes via `Game.pause()` without changing the
  screen; `handleEscape` (`664-672`) falls through to `resumeCurrentGame()`. On portrait phones the game
  silently runs behind the rotation overlay.

### M9. Mute button is dead code — no mid-run audio toggle
- `client/src/components/hud/MuteButton.tsx` never imported (grep = zero). `toggleMute()`/`muteVisible`
  plumbing exists (`gameController.ts:147,376-381`) but is unreachable. Audio only settable pre-run.

Fix: wire MuteButton into the HUD, or delete the dead plumbing.

### M10. Yeti difficulty differs between solo and multiplayer
- Solo presets (`client/src/game/Yeti.ts:130-155`): hard trigger 1400, extreme 850. Shared sim
  (`shared/AuthoritativeSim.ts:925-938`): hard 1300, extreme 550. Same label, harder chase in MP at
  hard/extreme. Solo chase is position-based 3D; MP uses a gap model. Extreme 26 vs BOOST 28 — 2 u/s margin.

### M11. No snapshot-age watchdog — loss spikes cause late, untrustworthy deaths
- Snapshots are `volatile` (`server/AuthoritativeRoomRuntime.ts:178`). During a drought the client keeps
  predicting from a stale ack; only reconciliation is a hard snap at >8m error (`Game.ts:1314`). Compounds C1/C2.

### M12. Third-person camera has no obstacle/terrain collision
- `client/src/game/Camera.ts:31-82`: fixed offset (0, 7, -10), plain lerp follow, no raycast. Clips through
  trees the skier passes and can dip under visual terrain relief on high graphics.

---

## 🟡 Minor

- **Predicted deaths hidden up to RTT** — lethal crash renders as "hp 1, still skiing" until the snapshot
  lands (`Game.ts:1270-1275`).
- **Player-vs-player shove not re-resolved against hazards** — knockback into tree/hole is unpreventable,
  stacks shove + obstacle damage (`AuthoritativeSim.ts:872-905`).
- **Ramp-jump pass-through** — mid-air from a ramp, trees are non-solid (`Player.ts:323`), you fly through
  tree canopies.
- **Remote players freeze >140ms** then jump (`client/src/game/RemotePlayer.ts:114-126`).
- **Ice-grip oversteer in render residual** — extrapolation uses full turn rate where sim applies
  `grip * 0.22` (`Game.ts:1295-1299`).
- **Solo `/api/rankings` POST unauthenticated** — fake solo scores trivially POSTable (`server/index.ts:174-191`).
- **`NET_UPDATE_HZ` referenced but never defined** (`Game.ts:1108`) → NaN; currently dead (authoritative path
  short-circuits) but silently disables the legacy broadcast path.
- **Esc dead on title-screen Settings** — keyboard-only players must use the mouse (`gameController.ts:665`).
- **HowToPlay marks itself seen before it's read**, can't be keyboard-dismissed (`App.tsx:37-41`).
- **Global Ctrl/Cmd+W/Q/S blocking** not exempted inside text inputs (`gameController.ts:24,655-662`), while
  Game.ts's dev-mode guard protects inputs.
- **Daily Challenge "Again" isn't the daily challenge** — re-rolls a random seed, drops `dailyKey`/fixed rules
  (`gameController.ts:291-298` vs 230-246).
- **Ranking "Today" tab silently fails offline**, keys off current settings mode (`RankingScreen.tsx:32-45`).
- **"Name saved."** rendered as a red error toast (`gameController.ts:186`).
- **`invertMouseY` leaks into touch joystick Y** (`Input.ts:168-174`) — mouse preference flips up=boost on touch.
- **First-snapshot spawn snap** — client pre-seeds `_authState` at x=0, server spawns across lanes
  (`Game.ts:588-596`, `AuthoritativeRoomRuntime.ts:38-46`).
- **`FixedStepClock` drops sim time on >250ms stalls** — yeti chase effectively gives free escape time after
  server hiccups (`AuthoritativeSim.ts:54-66`).
- **Two near-identical LCGs, different divisors** (`seed/4294967296` vs `seed/0xFFFFFFFF`) — determinism
  landmine for future changes.

---

## Fix order (highest leverage first)

- [x] 1. Blur/visibility: clear held keys + auto-pause solo + warn/suspend input in MP (C1, C2, M3)
- [x] 2. Multiplayer disconnect recovery: listen for `disconnect`, stop the run cleanly, rejoin or lobby (C2)
- [x] 3. Un-negate joystick X (`Joystick.tsx:25`) — one-character mirrored-steering fix (M1)
- [x] 4. Match MP hitboxes to visuals — derive visual scale from sim records (M2)
- [x] 5. Wire mute button / apply settings live / confirm ranking wipe (M5, M6, M9)
- [x] 6. Disable or annotate Sky Mario in the lobby (M7)
- [x] 7. Esc/OrientationGate pause-state cooperation (M8)
- [x] 8. Yeti trigger-distance parity solo vs MP (M10)
- [x] 9. Snapshot-age watchdog (M11)
- [x] 10. Camera obstacle/terrain avoidance (M12)
- [x] 11. keyTurnSpeed parity in MP (M4)
- [x] 12. Minor batch: RTT death reveal, shove re-resolution, NET_UPDATE_HZ, Ctrl-block inputs, daily "Again",
        "Name saved." toast, joystick invert leak, spawn snap, ranking Today error state (🟡 list)
