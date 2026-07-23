const MAX_DISPLAY_SPEED_KMH = 105;

export function SpeedMeter({ distance, speed }: { distance: number; speed: number }) {
  const speedKmh = Math.round(speed * 3.6);
  const pct = Math.max(0, Math.min(100, (speedKmh / MAX_DISPLAY_SPEED_KMH) * 100));

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
    </div>
  );
}
