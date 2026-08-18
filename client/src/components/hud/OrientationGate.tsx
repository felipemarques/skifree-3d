import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { isPortraitOrientation } from '@/utils/touch';
import type { GameController } from '@/app/gameController';

/**
 * The chase camera's fixed vertical FOV collapses to a very narrow
 * horizontal field of view on a portrait phone aspect - reworking Camera.ts
 * to be portrait-aware is a much bigger, riskier redesign than this feature
 * needs, so touch play defaults to landscape: freeze the sim and prompt a
 * rotate instead of rendering an unplayably narrow view. "Continue Anyway"
 * always escapes this - a misdetected environment (e.g. a touch-capable
 * laptop matching pointer:coarse in a tall window) must never hard-block
 * play with no way out.
 */
export function OrientationGate({ active, controller }: { active: boolean; controller: GameController | null }) {
  const [portrait, setPortrait] = useState(() => isPortraitOrientation());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = () => setPortrait(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Rotating back out of portrait re-arms the prompt for next time.
  useEffect(() => {
    if (!portrait) setDismissed(false);
  }, [portrait]);

  const blocking = active && portrait && !dismissed;

  // Freezes the sim directly (not pauseCurrentGame/resumeCurrentGame, which
  // navigate the UI to the 'pause' screen - see setSimulationPaused).
  useEffect(() => {
    controller?.setSimulationPaused(blocking);
  }, [blocking, controller]);

  if (!blocking) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal-flash)] flex flex-col items-center justify-center gap-3 bg-slate-950/95 px-6 text-center">
      <RotateCcw className="h-10 w-10 text-cyan-300" />
      <div className="text-lg font-black text-white">Rotate your device</div>
      <div className="text-sm text-[#c7d6ea]">This game plays best in landscape.</div>
      <button
        type="button"
        className="pointer-events-auto mt-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white/80 hover:text-white"
        onClick={() => setDismissed(true)}
      >
        Continue Anyway
      </button>
    </div>
  );
}
