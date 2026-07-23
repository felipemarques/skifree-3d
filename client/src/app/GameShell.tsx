import { useEffect, useRef } from 'react';
import { ReactUiAdapter } from './ReactUiAdapter';
import { GameController } from './gameController';
import type { UiStore } from './uiStore';

interface GameShellProps {
  store: UiStore;
  onReady(controller: GameController): void;
}

export function GameShell({ store, onReady }: GameShellProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const adapter = new ReactUiAdapter(store);
    const controller = new GameController(hostRef.current, adapter, store);
    onReady(controller);

    return () => {
      controller.destroy();
    };
  }, [onReady, store]);

  return <div ref={hostRef} aria-hidden="true" />;
}
