// True max is BOOST_SPEED(28 m/s) * 3.6 = 100.8 km/h (shared/AuthoritativeSim.ts,
// client/src/game/Player.ts) - was 105, which meant the bar could never
// actually reach full even at max boost.
const MAX_DISPLAY_SPEED_KMH = 101;
// Mirrors MOMENTUM_BONUS_THRESHOLD/MOMENTUM_MAX_BONUS_RATE in
// shared/AuthoritativeSim.ts and Player.ts - display only, doesn't affect
// scoring, just needs to describe the same numbers the game actually uses.
const MOMENTUM_BONUS_THRESHOLD = 0.5;
const MOMENTUM_MAX_BONUS_RATE = 0.3;

export function SpeedMeter({ distance, speed, momentum = 0 }: { distance: number; speed: number; momentum?: number }) {
  const speedKmh = Math.round(speed * 3.6);
  const pct = Math.max(0, Math.min(100, (speedKmh / MAX_DISPLAY_SPEED_KMH) * 100));
  const momentumPct = Math.max(0, Math.min(100, momentum * 100));
  const momentumActive = momentum > MOMENTUM_BONUS_THRESHOLD;
  const momentumMultiplier = 1 + Math.max(0, momentum - MOMENTUM_BONUS_THRESHOLD) / (1 - MOMENTUM_BONUS_THRESHOLD) * MOMENTUM_MAX_BONUS_RATE;

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-xs font-extrabold uppercase tracking-wide text-[#aab9cf]">
        Distance <span className="text-[22px] normal-case tracking-normal text-white">{Math.round(distance)} m</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs font-extrabold uppercase tracking-wide text-[#aab9cf]">
        Speed <span className="text-[22px] normal-case tracking-normal text-white">{speedKmh} km/h</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8be28b] via-[#79e7ff] to-[#65b8ff] transition-[width] duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
      {momentum > 0.02 && (
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[10px] font-extrabold uppercase tracking-wide text-[#aab9cf]">
            Momentum
            <span className={momentumActive ? 'text-amber-300' : 'text-[#aab9cf]'}>
              {momentumActive ? `Bonus x${momentumMultiplier.toFixed(2)}` : `${Math.round(momentumPct)}%`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
            <div
              className={`h-full rounded-full transition-[width] duration-150 ${momentumActive ? 'bg-amber-300 shadow-[0_0_8px_rgba(255,193,71,0.6)]' : 'bg-white/40'}`}
              style={{ width: `${momentumPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
