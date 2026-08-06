import { useEffect, useRef } from 'react';
import { Home, Play, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GameController } from '@/app/gameController';
import { Brand, ScreenFrame } from './ScreenFrame';
import { useTouchActive } from '@/utils/touch';

export function PauseScreen({ controller, multiplayer = false }: { controller: GameController; multiplayer?: boolean }) {
  const touchActive = useTouchActive();
  const resumeButtonRef = useRef<HTMLButtonElement>(null);

  // Overrides ScreenFrame's generic panel-focus (runs after it, since this
  // effect belongs to the parent) - Resume is the action a player almost
  // always wants, so that's what a keyboard user's next Tab/Enter should hit.
  useEffect(() => {
    resumeButtonRef.current?.focus();
  }, []);

  return (
    <ScreenFrame panelClassName="text-center">
      <Brand eyebrow="Paused" title="Run Paused" />
      <div className="grid gap-2">
        <Button ref={resumeButtonRef} type="button" onClick={() => controller.resumeCurrentGame()}>
          <Play className="h-4 w-4" />
          Resume
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.openSettings('pause')}>
          <Settings className="h-4 w-4" />
          Settings
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.mainMenu()}>
          <Home className="h-4 w-4" />
          Main Menu
        </Button>
      </div>
      {multiplayer && (
        <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-amber-200/90">
          Your run keeps going on the server while paused — the skier keeps
          moving and can crash. Resume quickly.
        </p>
      )}
      {!touchActive && <div className="text-sm text-[#aab9cf]">Press Esc to resume</div>}
    </ScreenFrame>
  );
}
