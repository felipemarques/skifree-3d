import type { YetiThreat } from '@/types/app';

export function YetiRadar({ threats, touchActive = false }: { threats: YetiThreat[]; touchActive?: boolean }) {
  if (!threats.length) return null;
  const maxDistance = 140;

  // Shifted up out of the on-screen jump button's footprint (TouchControls.tsx
  // anchors it to the same bottom-right corner).
  const positionClass = touchActive
    ? 'bottom-[116px] right-4 w-[118px]'
    : 'bottom-4 right-4 w-[132px] max-sm:bottom-2.5 max-sm:right-2.5 max-sm:w-[118px]';

  return (
    <div className={`hud-radar-wrapper pointer-events-none fixed z-[var(--z-hud-panel)] text-red-50 ${positionClass}`}>
      <div className="hud-glass grid gap-1.5 border-red-300/40 bg-red-950/50 p-2">
        <div className="flex justify-between text-[10px] font-black uppercase tracking-wide text-red-200">
          <span>Yeti</span>
          <span>{Math.round(threats[0].distance)}m</span>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-full border border-white/15 bg-[radial-gradient(circle,rgba(255,93,100,0.08)_0_18%,transparent_19%_100%),linear-gradient(90deg,transparent_49%,rgba(255,255,255,0.12)_50%,transparent_51%),linear-gradient(0deg,transparent_49%,rgba(255,255,255,0.12)_50%,transparent_51%),rgba(9,20,34,0.52)]">
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(121,231,255,0.75)]" />
          {threats.slice(0, 6).map((threat, index) => {
            const scale = Math.min(1, threat.distance / maxDistance);
            const x = 50 + Math.max(-42, Math.min(42, (threat.dx / maxDistance) * 42));
            const y = 50 - Math.max(-42, Math.min(42, (threat.dz / maxDistance) * 42));
            const size = Math.round(9 + (1 - scale) * 7);
            const urgent = threat.distance < 42;
            return (
              <span
                key={`${index}-${Math.round(threat.dx)}-${Math.round(threat.dz)}`}
                className={`yeti-dot-pulse absolute rounded-full ${urgent ? 'bg-white shadow-[0_0_16px_rgba(255,77,93,1)]' : 'bg-red-500 shadow-[0_0_12px_rgba(255,77,93,0.85)]'}`}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: size,
                  height: size,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
