import type { GameMode } from '@/types/app';

export function ControlsPanel({ gameMode, notice, touchActive = false }: { gameMode: GameMode; notice: string; touchActive?: boolean }) {
  // On touch, the on-screen D-pad/jump button (TouchControls.tsx) are the
  // legend - showing keyboard/mouse hints (and sitting in the same
  // bottom-left corner the D-pad now occupies) would just be confusing.
  // Still surface `notice` (Health +1 / Near Miss / Jump Chain etc.) - that's
  // live feedback, not a static key legend - just relocated out of the way.
  if (touchActive) {
    if (!notice) return null;
    return (
      <div className="hud-glass pointer-events-none fixed left-1/2 top-16 z-[60] -translate-x-1/2 px-3 py-1.5 text-center text-xs font-black text-white max-sm:top-14">
        {notice}
      </div>
    );
  }

  const items = [
    ['A / D', 'Turn'],
    ['W', 'Brake'],
    ['S / Shift', 'Boost'],
    ['Space', 'Jump'],
    ['Mouse', 'Steer / speed'],
    ['Esc', 'Pause'],
  ];

  if (gameMode === 'sky_mario') {
    items.push(['E / Ctrl', 'Throw']);
    items.push(['Click', 'Throw']);
  }

  return (
    <div className="hud-glass pointer-events-none fixed bottom-4 left-4 z-[60] w-[min(430px,calc(100vw-32px))] p-3 text-white/80 max-sm:bottom-[136px] max-sm:left-2.5 max-sm:right-2.5 max-sm:w-auto">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-300">
        {gameMode === 'sky_mario' ? 'Sky Mario Controls' : 'Controls'}
      </div>
      {notice && <div className="mb-2 text-xs font-black text-white">{notice}</div>}
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
  );
}
