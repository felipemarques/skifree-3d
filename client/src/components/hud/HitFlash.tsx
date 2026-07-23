import { useEffect, useState } from 'react';

export function HitFlash({ flashKey }: { flashKey: number }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!flashKey) return;
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), 90);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[300] bg-red-500/25 opacity-0 transition-opacity duration-150 ${active ? 'hit-flash-active' : ''}`}
    />
  );
}
