// Mirrors BASE_SPEED/BOOST_SPEED in Player.ts/shared/AuthoritativeSim.ts -
// display-only, ramps radial streak lines in as speed approaches boost so
// sustained boosting reads as kinetic, not just a bigger number on the HUD.
const RAMP_START_SPEED = 19;
const MAX_SPEED = 28;
const MAX_OPACITY = 0.2;

export function SpeedLines({ speed }: { speed: number }) {
  const t = Math.max(0, Math.min(1, (speed - RAMP_START_SPEED) / (MAX_SPEED - RAMP_START_SPEED)));
  if (t <= 0) return null;
  return (
    <div
      className="speed-lines pointer-events-none fixed inset-0 z-[var(--z-hud-speedlines)]"
      style={{ opacity: t * MAX_OPACITY }}
    />
  );
}
