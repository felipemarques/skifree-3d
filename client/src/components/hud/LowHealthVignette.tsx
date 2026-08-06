export function LowHealthVignette({ hp, active }: { hp: number; active: boolean }) {
  const show = active && hp === 1;

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[var(--z-hud-vignette)] transition-opacity duration-700 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="low-hp-vignette-pulse h-full w-full" />
    </div>
  );
}
