import { useEffect } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import type { GameController } from '@/app/gameController';
import { settings } from '@/utils/Settings';
import { Joystick } from './Joystick';

/**
 * Mobile on-screen affordances: a floating joystick (steer + speed, see
 * Joystick.tsx) on the left and a jump button on the right - no spacebar
 * equivalent otherwise. The joystick is skipped when Control Mode is
 * 'gyro' (device tilt steers instead, see GyroControl.ts) - showing both
 * would invite fighting inputs, and the jump button is still needed either
 * way. Read directly rather than via a hook since GameHud (this
 * component's parent) already re-renders every frame.
 */
export function TouchControls({ controller }: { controller: GameController | null }) {
  // Same reasoning as Joystick's own unmount cleanup - a screen change
  // mid-press otherwise leaves jump permanently "held" in Input.ts.
  useEffect(() => {
    return () => controller?.setTouchJump(false);
  }, [controller]);

  const useGyro = settings.get('controlMode') === 'gyro';

  return (
    <>
      {!useGyro && <Joystick controller={controller} />}

      <button
        type="button"
        aria-label="Jump"
        className="hud-jump-button-wrapper pointer-events-auto fixed bottom-6 right-5 z-[var(--z-touch-jump)] flex h-20 w-20 items-center justify-center rounded-full border border-white/25 bg-slate-950/45 text-white/90 backdrop-blur active:bg-slate-900/70 max-sm:h-16 max-sm:w-16"
        style={{ touchAction: 'none' }}
        onTouchStart={event => { event.preventDefault(); controller?.setTouchJump(true); }}
        onTouchEnd={event => { event.preventDefault(); controller?.setTouchJump(false); }}
        onTouchCancel={event => { event.preventDefault(); controller?.setTouchJump(false); }}
        onMouseDown={() => controller?.setTouchJump(true)}
        onMouseUp={() => controller?.setTouchJump(false)}
      >
        <ArrowUpCircle className="h-9 w-9 max-sm:h-7 max-sm:w-7" />
      </button>
    </>
  );
}
