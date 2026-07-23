import type { UiStoreState } from '@/types/app';
import { ControlsPanel } from './ControlsPanel';
import { Hearts } from './Hearts';
import { HitFlash } from './HitFlash';
import { PlayerStatusPanel } from './PlayerStatusPanel';
import { SpeedMeter } from './SpeedMeter';
import { YetiRadar } from './YetiRadar';

export function GameHud({ state }: { state: UiStoreState }) {
  const showHud = state.screen === 'game' || state.screen === 'pause';
  const showControls = state.screen === 'game';

  return (
    <>
      {showHud && (
        <div className="pointer-events-none fixed left-4 top-4 z-[60] w-[242px] max-sm:left-2.5 max-sm:top-2.5 max-sm:w-[min(230px,calc(100vw-20px))]">
          <div className="hud-glass grid gap-2.5 p-3">
            <Hearts hp={state.hud.hp} flashKey={state.healFlashKey + state.hitFlashKey} />
            <SpeedMeter distance={state.hud.distance} speed={state.hud.speed} />
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
              {state.hud.spectatorTarget && (
                <div className="max-w-full rounded-full border border-yellow-300/40 bg-yellow-300/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-yellow-100">
                  Viewing {state.hud.spectatorTarget}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showControls && <ControlsPanel gameMode={state.gameMode} notice={state.controlsNotice} />}
      {showHud && <PlayerStatusPanel players={state.playerList} />}
      {showHud && <YetiRadar threats={state.yetiThreats} />}
      {state.yetiWarning && (
        <div className="yeti-warning-pulse pointer-events-none fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-lg border border-red-300/50 bg-red-950/70 px-3.5 py-2 text-base font-black uppercase tracking-[0.08em] text-red-50 shadow-2xl backdrop-blur max-sm:top-2 max-sm:max-w-[calc(100vw-20px)] max-sm:text-sm">
          YETI INBOUND
        </div>
      )}
      <HitFlash flashKey={state.hitFlashKey} />
    </>
  );
}
