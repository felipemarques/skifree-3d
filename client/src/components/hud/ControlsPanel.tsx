import { useEffect, useState } from 'react';
import type { GameMode } from '@/types/app';
import { settings } from '@/utils/Settings';

// How long the static key legend stays up before auto-hiding, and the
// events that dismiss it early - once a player has actually steered/
// boosted/jumped they've demonstrated they know the controls. Remounts
// (see GameHud's `showControls = state.screen === 'game'`, which unmounts
// this component on pause) naturally re-show it on resume, so it stays
// reachable from the pause menu for free without extra plumbing.
const LEGEND_AUTO_HIDE_MS = 8000;

export function ControlsPanel({ gameMode, notice, touchActive = false }: { gameMode: GameMode; notice: string; touchActive?: boolean }) {
  const [legendVisible, setLegendVisible] = useState(true);

  useEffect(() => {
    setLegendVisible(true);
    const hideTimer = window.setTimeout(() => setLegendVisible(false), LEGEND_AUTO_HIDE_MS);
    const dismiss = () => setLegendVisible(false);
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, [gameMode]);

  // Transient feedback (Health +1 / Near Miss / Jump Chain…) is live
  // scoring info, not a static legend - it stays visible regardless of
  // touch mode or the legend's own auto-hide state, just raised above the
  // stat panel (--z-hud-stat) so it's never rendered underneath it on phones.
  const noticeBanner = notice ? (
    <div className="hud-glass pointer-events-none fixed left-1/2 top-16 z-[var(--z-hud-alert)] -translate-x-1/2 px-3 py-1.5 text-center text-xs font-black text-white max-sm:top-14">
      {notice}
    </div>
  ) : null;

  if (touchActive) {
    // On touch, the on-screen D-pad/jump button (TouchControls.tsx) are the
    // legend - a keyboard/mouse key grid would just be confusing clutter in
    // the same corner the D-pad occupies, so only the notice banner applies.
    // Gyro mode has no on-screen D-pad to look at though, so it gets its
    // own brief auto-hiding hint instead (there's no joystick ring to imply
    // the tilt mapping the way the touch D-pad implies steer/speed).
    if (settings.get('controlMode') === 'gyro') {
      return (
        <>
          {noticeBanner}
          {legendVisible && (
            <div className="hud-glass pointer-events-none fixed bottom-4 left-1/2 z-[var(--z-hud-panel)] w-[min(320px,calc(100vw-32px))] -translate-x-1/2 p-2.5 text-center text-[11px] font-bold leading-snug text-[#deeeff] max-sm:bottom-[310px]">
              Tilt left/right to steer &middot; tilt forward to boost, back to brake
            </div>
          )}
        </>
      );
    }
    return noticeBanner;
  }

  const items = [
    ['A / D', 'Turn'],
    ['W', 'Brake'],
    ['S / Shift / F', 'Boost'],
    ['Space', 'Jump'],
    ['Mouse', 'Steer / speed'],
    ['Esc', 'Pause'],
  ];

  if (gameMode === 'sky_mario') {
    items.push(['E / Ctrl / Click', 'Throw']);
  }

  return (
    <>
      {noticeBanner}
      {legendVisible && (
        <div className="hud-glass pointer-events-none fixed bottom-4 left-4 z-[var(--z-hud-panel)] w-[min(430px,calc(100vw-32px))] p-3 text-white/80 max-sm:bottom-[310px] max-sm:left-2.5 max-sm:right-2.5 max-sm:w-auto">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-300">
            {gameMode === 'sky_mario' ? 'Sky Mario Controls' : 'Controls'}
          </div>
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-1.5 max-sm:grid-cols-2">
            {items.map(([key, label]) => (
              <div key={`${key}-${label}`} className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold leading-tight text-[#deeeff] max-sm:text-[10px]">
                <span className="min-w-5 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-center text-[10px] font-black text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)]">
                  {key}
                </span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
