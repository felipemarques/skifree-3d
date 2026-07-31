import type { UiStoreState } from '@/types/app';
import type { GameController } from '@/app/gameController';
import { isTouchActive } from '@/utils/touch';
import { ControlsPanel } from './ControlsPanel';
import { Hearts } from './Hearts';
import { HitFlash } from './HitFlash';
import { LowHealthVignette } from './LowHealthVignette';
import { MuteButton } from './MuteButton';
import { OrientationGate } from './OrientationGate';
import { PlayerStatusPanel } from './PlayerStatusPanel';
import { SpeedMeter } from './SpeedMeter';
import { TouchControls } from './TouchControls';
import { YetiRadar } from './YetiRadar';

export function GameHud({ state, controller }: { state: UiStoreState; controller: GameController | null }) {
  const showHud = state.screen === 'game' || state.screen === 'pause';
  const showControls = state.screen === 'game';
  const touchActive = isTouchActive();
  const cs = controller?.getSnapshot();

  return (
    <>
      {showHud && (
        <div className="hud-stat-wrapper pointer-events-none fixed left-4 top-4 z-[60] w-[242px] max-sm:left-2.5 max-sm:top-2.5 max-sm:w-[min(230px,calc(100vw-20px))]">
          <div className="hud-glass grid gap-2.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <Hearts hp={state.hud.hp} flashKey={state.healFlashKey + state.hitFlashKey} />
              <MuteButton visible={!!controller && !!cs?.muteVisible} muted={!!cs?.muted} onToggle={() => controller?.toggleMute()} className="h-8 w-8 bg-white/10" />
            </div>
            <SpeedMeter distance={state.hud.distance} speed={state.hud.speed} momentum={state.hud.momentum} />
            <div className="flex flex-wrap gap-2">
              <div className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${state.hud.isAirborne ? 'border-cyan-300/50 bg-blue-500/30 text-white' : 'border-white/15 bg-white/10 text-[#dceeff]'}`}>
                {state.hud.isAirborne ? 'Air' : 'Ground'}
              </div>
              <div className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#dceeff]">
                {state.hud.graphicsQuality}
              </div>
              {state.hud.spawnShieldSeconds > 0 && (
                <div className="rounded-full border border-cyan-300/50 bg-blue-500/30 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-[0_0_14px_rgba(121,231,255,0.2)]">
                  Shield {Math.ceil(state.hud.spawnShieldSeconds)}s
                </div>
              )}
              {state.hud.chainCount >= 2 && (
                <div className="relative overflow-hidden rounded-full border border-amber-300/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-100 shadow-[0_0_14px_rgba(255,193,71,0.25)]">
                  <div
                    className="absolute inset-y-0 left-0 bg-amber-500/40 transition-[width] duration-150 ease-linear"
                    style={{ width: `${Math.max(0, Math.min(100, state.hud.chainRemainingT * 100))}%` }}
                  />
                  <span className="relative">Chain x{state.hud.chainCount}</span>
                </div>
              )}
              {state.hud.cleanStreakSeconds >= 5 && (
                <div className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${state.hud.cleanStreakSeconds >= 45 ? 'border-emerald-300/60 bg-emerald-500/25 text-emerald-100 shadow-[0_0_14px_rgba(52,211,153,0.3)]' : 'border-white/15 bg-white/10 text-[#dceeff]'}`}>
                  Clean Run {Math.floor(state.hud.cleanStreakSeconds)}s
                </div>
              )}
              {state.hud.yetiDangerT > 0 && (
                <div className="animate-pulse rounded-full border border-red-300/50 bg-red-600/25 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-red-100 shadow-[0_0_14px_rgba(255,90,90,0.3)]">
                  Danger Bonus
                </div>
              )}
              {state.hud.iceGripT > 0.15 && (
                <div className="rounded-full border border-cyan-200/50 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-cyan-100 shadow-[0_0_14px_rgba(165,243,252,0.25)]">
                  Icy
                </div>
              )}
              {state.hud.blizzardT > 0.3 && (
                <div className="rounded-full border border-slate-200/40 bg-slate-400/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-100">
                  Blizzard
                </div>
              )}
              {state.hud.spectatorTarget && (
                <div className="max-w-full rounded-full border border-yellow-300/40 bg-yellow-300/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-yellow-100">
                  Viewing {state.hud.spectatorTarget}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showControls && <ControlsPanel gameMode={state.gameMode} notice={state.controlsNotice} touchActive={touchActive} />}
      {showHud && <PlayerStatusPanel players={state.playerList} touchActive={touchActive} />}
      {showHud && <YetiRadar threats={state.yetiThreats} touchActive={touchActive} />}
      {state.yetiWarning && (
        <div className="yeti-warning-pulse pointer-events-none fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-lg border border-red-300/50 bg-red-950/70 px-3.5 py-2 text-base font-black uppercase tracking-[0.08em] text-red-50 shadow-2xl backdrop-blur max-sm:top-2 max-sm:max-w-[calc(100vw-20px)] max-sm:text-sm">
          YETI INBOUND
        </div>
      )}
      {showControls && touchActive && <TouchControls controller={controller} />}
      <OrientationGate active={showControls && touchActive} controller={controller} />
      <LowHealthVignette hp={state.hud.hp} active={showHud} />
      <HitFlash flashKey={state.hitFlashKey} />
    </>
  );
}
