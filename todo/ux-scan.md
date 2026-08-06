# SkiFree 3D — UX Scan & Remediation Plan

Scan date: 2026-08-04. Sources: parallel agent audits of all screens + HUD components, a
fix-verification pass against `todo/gameplay-scan.md` (2026-07-31), and first-hand verification
of every high-impact finding in `gameController.ts`, `Game.ts`, `ReactUiAdapter.ts`, `GameHud.tsx`,
`SettingsScreen.tsx`, `LobbyScreen.tsx`, `HowToPlayScreen.tsx`, `RankingScreen.tsx`, `TitleScreen.tsx`,
`ScreenFrame.tsx`, and `index.css`.

Severity: 🔴 high · 🟠 medium · 🟡 low.

---

## Verified already fixed (prior scan, all confirmed in current code)

- C1: blur/visibilitychange clears held keys; solo auto-pauses on tab hide (`Input.ts:39-77`, `gameController.ts:826-829`).
- C2: mid-run disconnect → reconnect window + clean teardown; `room:error` ends zombie runs (`gameController.ts:768-798`, `:725-741`).
- M1: joystick X no longer mirrored (`Joystick.tsx:24-26`).
- M5: settings apply live via `applySettingsLive` (`gameController.ts:332-350`, `Game.ts:319-328`).
- M6: ranking Clear has a two-step confirm (`RankingScreen.tsx:37,63-69,134-149`).
- M7: Sky Mario is now server-supported end-to-end (was a lobby dead-end).
- M8: Esc cannot resume a frozen sim behind an overlay (`gameController.ts:831-843`).
- M9: MuteButton wired into the HUD (`GameHud.tsx:9,53`).
- M11: snapshot-age watchdog (`Game.ts:96-97,1532,1839-1851`).
- M12: camera obstacle/terrain collision (`Camera.ts:14-21,68-78,103-109,141-165`).
- Minor: "Name saved." is a green notice (`gameController.ts:196-203`); Ctrl-block exempts text inputs
  (`gameController.ts:801-813`); daily "Again" replays the same daily; "Today" keys off the daily's pinned mode.

**Investigated and dismissed:** the claimed "OrientationGate silently resumes a paused game" bug —
every screen-change path while the gate blocks is guarded (Esc no-op, `pauseCurrentGame` guard,
`_gameOverSent` gate at `Game.ts:2486`). False positive.

---

## New findings

### 🔴 High — mobile players lose critical info

| # | Finding | Location |
|---|---|---|
| 1 | "YETI INBOUND" banner is partially hidden behind the stat panel on phones: banner `z-[70]` centered at `top-4`, stat panel `z-[110]` ~230px wide from the left. On a 375px phone the left half of the game's most important warning renders under the panel. | `GameHud.tsx:140` vs `:27` |
| 2 | All transient feedback ("Health +1", "Near Miss…") renders under the stat panel on touch — same z/position conflict (`z-[60] top-16` vs panel `z-[110]`). Players miss score feedback that fires constantly. | `ControlsPanel.tsx:12` |
| 3 | Portrait/narrow-screen multiplayer: leaderboard (`min-w-44` top-right) collides with the stat panel (left, ~230px). Under ~430px width, HP and ping become unreadable. | `PlayerStatusPanel.tsx:10-13` + `GameHud.tsx:27` |
| 4 | Narrow non-touch: ControlsPanel (`max-sm:bottom-[136px]` full width) overlaps PlayerStatusPanel (`max-sm:bottom-[150px]`). Same right-side band; the leaderboard paints over the key legend. | `ControlsPanel.tsx:33`, `PlayerStatusPanel.tsx:10` |
| 5 | Touch players have no way to pause. Esc is keyboard-only; the HUD exposes joystick + jump only. Only backgrounding the tab pauses. | `GameHud.tsx:144`, `gameController.ts:831-843` |
| 6 | The controls legend is a permanent, never-dismissing obstruction over the bottom-left of the play view for the entire run, in both modes. No auto-hide on input. | `GameHud.tsx:136`, `ControlsPanel.tsx:33` |

### 🟠 Medium — feedback lies / state races

| # | Finding | Location |
|---|---|---|
| 7 | Settings caption contradicts actual behavior. Nothing applies until Save (the form is local state; Back silently discards changes), yet the caption claims Control Mode/Touch/Mouse/Invert/Fog/Snowfall "apply immediately" — and Sound Volume *does* apply on save but the caption says next run. Misleading in both directions. | `SettingsScreen.tsx:118-131` + `gameController.ts:332-350` |
| 8 | A new run flashes the dead run's HUD (gray hearts, old chips) for the 100–800ms synchronous shader prewarm, because `showGame` merges `...current.hud` and the store is never reset between runs. | `ReactUiAdapter.ts:72-87`, `Game.ts:782-798` |
| 9 | Multiplayer pause still fires first-person hit feedback behind the pause screen — audio, camera shake, particles, and a hitstop that only drains on resume (delayed slow-mo). A mid-pause death runs its animation invisibly and you resume already dead. | `Game.ts:1968-1973` (no `isPaused` guard) |
| 10 | Game-over `setTimeout` is never cancelled on `destroy()` — leaving a run during the gameover delay (MP disconnect → menu) fires `showGameOver` later and flips the menu back to the game-over screen. | `Game.ts:2164-2177` vs `destroy()` `:2563-2605` |
| 11 | Ranking navigation races + zero loading state. `showRankingScreen` awaits the fetch *before* navigating — clicking Ranking then Settings gets you yanked back; two rapid name-clicks can resolve out of order; the button looks dead on a slow server. | `gameController.ts:362-385` |
| 12 | "Connecting…" can stick forever on Create/Join if the server doesn't respond (no timeout/abort; `pendingRoom` only clears on `room:error`). | `TitleScreen.tsx:80-104` |
| 13 | "Today" tab's error state is unreachable — `getDaily()` swallows fetch failures into `[]`, so a dead network silently shows "No runs recorded yet." and a hung fetch shows "Loading…" forever. | `RankingScreen.tsx:44-61,92-99` + `RankingStore.ts` |
| 14 | Clearing the leaderboard leaves stale "Today" entries on screen, and the confirm step never says it wipes the daily board too. | `gameController.ts:381-385`, `RankingScreen.tsx:134-149` |
| 15 | "Again" silently starts a solo run after a multiplayer disconnect — the disconnect handler resets room state, `playAgain` falls through to solo with only a missed toast as warning. | `gameController.ts:768-798` + `:305-319` |
| 16 | Room code can't be copied. `body { user-select: none }` + no copy button means mobile players must retype the 6-char code they were just told to share. | `index.css:45-46`, `LobbyScreen.tsx:39-42` |
| 17 | Esc dead outside pause — `handleEscape` early-returns without `currentGame`, so keyboard-only players can't Esc out of title-screen Settings/Ranking/HowToPlay. | `gameController.ts:832` |

### 🟡 Low — polish, a11y, copy

| # | Finding | Location |
|---|---|---|
| 18 | HowToPlay is not a dialog: no `role="dialog"`/`aria-modal`, no Esc, no focus trap (Tab reaches buttons behind the overlay), focus not moved on open, and it marks itself "seen" the moment it opens before being read. Close button ~28px. | `HowToPlayScreen.tsx:36-44,106`, `App.tsx:37-41` |
| 19 | No focus management on any screen transition — keyboard users tab from the top of the document on every navigation; pause doesn't focus Resume. | `App.tsx:70-118`, `ScreenFrame.tsx:54-65` |
| 20 | Health is visual-only. Hearts have no accessible text, no `aria-live`; damage/heal/bonuses never announced. | `Hearts.tsx`, `HitFlash.tsx` |
| 21 | Toasts: no `role="alert"`/`aria-live`, no dismiss, and error+notice render in the same spot and can overlap. | `App.tsx:106-116` |
| 22 | Speed bar never visually fills — max display 105 km/h vs true max ~100.8 km/h. | `SpeedMeter.tsx` |
| 23 | Mute state doesn't persist across runs (fresh `AudioManager` each game); tap target is 32px. | `gameController.ts:398-403`, `GameHud.tsx:53` |
| 24 | Compact-landscape scaling covers only the stat panel — radar, status panel, and controls keep desktop sizing on landscape phones. | `index.css:183-186` |
| 25 | Lobby shows the countdown twice (badge "Starting in N" + disabled button "Starting N"); names line can overflow (8 names, no truncation). | `LobbyScreen.tsx:50-54,62`, `gameController.ts:149-151` |
| 26 | Mute not announced (`aria-pressed` missing); HitFlash renders unconditionally on every screen (can flash over a transition); unlabeled ping chip; ambiguous "Danger Bonus" / "Bonus x1.15" copy; ControlsPanel omits F (a valid boost key) and shows contradictory double-mouse lines in Sky Mario; unused props/dead APIs (`returnMode`, `updateControlsHint`, write-only flash keys); `isTouchActive()` computed at render; joystick input not cleared on unmount; magic colors/z-values instead of tokens. | various |

---

## Remediation plan

### Objective
Fix all verified UX issues above: mobile HUD visibility, misleading feedback, flow-state races,
accessibility, and polish — without touching gameplay physics or the authoritative sim.

### Files affected
- HUD: `GameHud.tsx`, `ControlsPanel.tsx`, `PlayerStatusPanel.tsx`, `TouchControls.tsx`, `Hearts.tsx`,
  `HitFlash.tsx`, `MuteButton.tsx`, `SpeedMeter.tsx`, `Joystick.tsx`
- Screens: `SettingsScreen.tsx`, `TitleScreen.tsx`, `LobbyScreen.tsx`, `RankingScreen.tsx`,
  `HowToPlayScreen.tsx`, `ScreenFrame.tsx`, `GameOverScreen.tsx` (minor)
- Core: `gameController.ts`, `ReactUiAdapter.ts`, `uiStore.ts`, `App.tsx`, `Game.ts`,
  `RankingStore.ts`, `Settings.ts`, `touch.ts`, `index.css`, `types/app.ts` (all under `client/src/`)

### Approach
- All fixes are presentational or client-flow only. Zero changes to `shared/AuthoritativeSim.ts`,
  the server runtime, or socket payloads.
- Each batch is independently shippable; A–C are the player-facing value, D is a11y, E is cleanup.
- Verification is manual browser testing (the developer runs the dev server; automation should not
  start it) + `npx tsc --noEmit` in `client/` + `npm run build`.

### Tasks

#### Batch A — Mobile HUD visibility
- [ ] **A1** Raise transient-feedback z/position on touch: move the notice in `ControlsPanel.tsx:12`
      below the stat panel (`top-44`) or `z-[120]` above it.
- [ ] **A2** Raise "YETI INBOUND" above the stat panel (`GameHud.tsx:140` → `z-[120]`) or re-anchor
      it below the panel on `max-sm`.
- [ ] **A3** Resolve `PlayerStatusPanel` collision: on `max-sm`+portrait stack it below the stat
      panel (top offset) instead of top-right; on `max-sm` non-touch give ControlsPanel and
      PlayerStatusPanel distinct vertical bands.
- [ ] **A4** Add a touch pause button in `GameHud.tsx` (44px target) when `touchActive && showControls`,
      wired to `controller.pauseCurrentGame()`.
- [ ] **A5** Auto-dismiss the controls legend: show for the first ~8s of a run and after mode change,
      hide on first steer/boost/jump input; keep access via a Pause-menu entry.

#### Batch B — Honest feedback
- [ ] **B1** Reset transient HUD state on run start: in `ReactUiAdapter.showGame` (`:72-87`) merge
      `defaultHud` (zeroed) under the incoming state instead of `...current.hud`, so the prewarm
      window can't flash the dead run's hearts/chips. Also reset on `resume()`.
- [ ] **B2** Settings honesty (`SettingsScreen.tsx:118-131` + `saveSettingsForm`): apply live where
      cheap — fog/snow via `applySettingsLive` on slider change (debounced), sfx volume via
      `audio.setVolume` — reword the caption to state exactly what applies live vs on Save vs next
      run; add an unsaved-changes confirm when pressing Back after edits.
- [ ] **B3** Remove the static graphics-quality chip from the HUD (`GameHud.tsx:84-86`).

#### Batch C — Flow robustness
- [ ] **C1** Cancel the pending game-over timer on destroy: store the `_scheduleFinalGameOver` timeout
      id (`Game.ts:2164-2177`) and `clearTimeout` it in `destroy()` (`:2563-2605`).
- [ ] **C2** Gate MP first-person feedback on pause: in `_onGameSnapshot`'s `hit`/`death` local-event
      branches (`Game.ts:1968-1982`), skip audio/shake/hitstop/particles when `this.isPaused` (still
      update HP so the pause screen shows truth); don't apply `triggerHitstop` while paused.
- [ ] **C3** Ranking navigation: navigate immediately (`ui.showRanking([])` + new `rankingLoading`
      flag in `UiStoreState`), populate after fetch; add AbortController/token to `showRankingDetail`
      (`gameController.ts:362-385`).
- [ ] **C4** Room-connect timeout: in `TitleScreen.tsx` wrap `pendingRoom` with a ~10s timer that
      re-enables buttons and surfaces "Server not responding" via the controller error path.
- [ ] **C5** Make `RankingStore.getDaily` reject on failure + add ~8s AbortController timeout so the
      `dailyError`/Retry UI (`RankingScreen.tsx:92-99`) actually fires.
- [ ] **C6** On clear, invalidate the Today tab: in `RankingScreen`'s clear handler also
      `setDailyEntries([])`; add scope text to the confirm step ("clears all-time and today's board").
- [ ] **C7** "Again" after MP disconnect: in `playAgain`, if room state was lost, disable the button
      with an explanatory label or confirm the solo fallback (`gameController.ts:305-319` +
      `GameOverScreen`).
- [ ] **C8** Copyable room code: re-enable `user-select` on the code block + add a copy-to-clipboard
      button in `LobbyScreen.tsx:39-42` (`navigator.clipboard` with fallback).
- [ ] **C9** Extend `handleEscape` to close Settings/Ranking/HowToPlay/back-out from any screen
      (`gameController.ts:831-843`), keeping the existing frozen-sim no-op. (depends on D1 for the
      HowToPlay Esc path)

#### Batch D — Accessibility
- [ ] **D1** HowToPlay as a proper dialog: `role="dialog"` + `aria-modal`, focus the close button on
      open, trap Tab (prefer the existing shadcn `dialog.tsx` primitive), Esc to close, restore focus
      to the opener; **move `hasSeenTutorial` marking from open to close** (`App.tsx:37-41`); enlarge
      the X button to 44px.
- [ ] **D2** Focus management on screen transitions: in `ScreenFrame.tsx` add `tabIndex={-1}` + focus
      the panel on mount (with prior-focus restore for pause).
- [ ] **D3** Accessible health: in `Hearts.tsx` add visually-hidden `role="img"` text ("Health 2 of 3")
      and feed HP changes into a shared `aria-live="polite"` region; announce damage/heal/bonus via
      the notice path.
- [ ] **D4** Toasts (`App.tsx:106-116`): `role="alert"`/`aria-live`, stack error+notice instead of the
      same slot, add a dismiss button, keep 3s auto-dismiss.

#### Batch E — Polish & cleanup
- [ ] **E1** `SpeedMeter` max display 105 → 100 km/h so the bar can actually fill.
- [ ] **E2** Persist mute across runs: store `muted` in `Settings`, init `AudioManager` from it,
      persist on `toggleMute` (`gameController.ts:398-403`).
- [ ] **E3** Extend `.is-compact-landscape` scaling to radar/status/touch controls (shared wrapper
      class in `index.css:183-186`). (depends on A3 layout decisions)
- [ ] **E4** Lobby: drop the duplicate countdown on the Start button (keep the badge,
      `LobbyScreen.tsx:50-54` + `gameController.ts:149-151`); truncate the names line (`:28,62`).
- [ ] **E5** Gate `HitFlash` behind `showHud` (`GameHud.tsx:148`); label the ping chip ("Ping 123ms");
      unify "Danger Bonus" copy with HowToPlay; add F to the boost legend or drop it from `Input`;
      merge the two sky-mario mouse lines; `aria-pressed` on MuteButton.
- [ ] **E6** Dead code/props: remove `returnMode` prop (`SettingsScreen`/`App.tsx:80`), remove or wire
      `updateControlsHint` (`types/app.ts:141`), remove or wire the four write-only flash keys
      (`ReactUiAdapter.ts:182-232`).
- [ ] **E7** Reactivity + cleanup: add a `useTouchActive` hook (subscribe to `matchMedia` instead of
      `isTouchActive()` at render — `touch.ts:13-19`, `GameHud.tsx:21`); Joystick/TouchControls
      unmount cleanup calling `setJoystickVector(0,0,false)` / `setTouchJump(false)`.
- [ ] **E8** Token consolidation (last): centralize the scattered `z-[60/70/95/110/120/...]` scale and
      hex colors (`#dceeff`, `#aab9cf`, `#7df7ba`, …) into CSS variables in `index.css`, replacing
      arbitrary values across HUD + screens. (depends on A1–A3, so the z-scale is settled first)

### Risks
- **A2/A3 z-index changes** could re-break mute-button clickability under the pause backdrop (the
  documented reason for `z-[110]`) → keep the hearts+mute row above the backdrop; verify pause-screen
  mute on desktop + mobile.
- **B2 live-apply** could cause mid-run re-renders/frame hiccups if sliders fire every tick →
  debounce live sliders (~150ms); verify the `applySettingsLive` path (`Game.ts:319-328`) before
  enabling more fields live.
- **C2 pause-gating** could hide a legitimate death reveal if a player pauses in MP while a fatal
  snapshot is in flight → keep HP/status updates and the death animation; only suppress first-person
  audio/shake/hitstop; verify "resume into death".
- **C1 timer cancel** interacts with the `_finalGameOverShown` guard — ensure no double-show after cancel.
- **D1 focus trap** could break if `dialog.tsx` differs in markup → prefer the shadcn `Dialog`
  primitive over hand-rolled trap.
- **E6 removals** may surface unused-import type errors → run `tsc --noEmit` after each removal.

### Test strategy
- **Static:** `cd client && npx tsc --noEmit`; `npm run build` at root after each batch.
- **Manual browser (per batch, on 375px phone + 1366×768 desktop + landscape phone):**
  - A: portrait run → banner + notices fully visible; leaderboard and stat panel don't collide; touch
    pause works; legend auto-hides after input.
  - B: start a second run → no stale hearts/chips flash; drag fog slider → visible change; Back after
    edits → unsaved-changes prompt.
  - C: MP pause → no hit audio/shake behind overlay, resume reflects truth; leave run during gameover
    delay → no late screen flip; kill server → Ranking shows error + Retry, "Connecting…" times out;
    disconnect MP then Game Over → "Again" doesn't silently go solo; copy button works on mobile.
  - D: Tab cycles only within HowToPlay; Esc closes it; focus lands on Resume for pause; screen
    reader announces health + toasts.
  - E: speed bar reaches full at boost; mute survives a second run; compact-landscape HUD fully
    scaled; countdown shown once.
- **Regression (must still pass after A–C):** `npm run test:sim` (`scripts/check-authoritative-sim.mjs`);
  solo pause/resume; MP reconnect flow (`?netDebug=1`).

### Open questions for the executor
1. Confirm `Game.applySettingsLive` covers fog/snow/control-mode before wiring B2 live sliders.
2. Verify `RankingStore.getDaily`'s exact swallow point before changing its contract (C5).
3. Confirm the pause-menu entry point for re-showing the controls legend (A5).
