import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { GameShell } from './GameShell';
import { createUiStore } from './uiStore';
import type { ControllerSnapshot } from '@/types/app';
import { TitleScreen } from '@/components/screens/TitleScreen';
import { SettingsScreen } from '@/components/screens/SettingsScreen';
import { LobbyScreen } from '@/components/screens/LobbyScreen';
import { RankingScreen } from '@/components/screens/RankingScreen';
import { GameOverScreen } from '@/components/screens/GameOverScreen';
import { PauseScreen } from '@/components/screens/PauseScreen';
import { GameHud } from '@/components/hud/GameHud';
import { MuteButton } from '@/components/hud/MuteButton';
import type { GameController } from './gameController';

const defaultControllerSnapshot: ControllerSnapshot = {
  playerName: 'Skier',
  isMultiplayer: false,
  isRoomHost: false,
  settingsReturnMode: 'title',
  roomSettingsLocked: true,
  roomStartLabel: 'Start Game',
  roomStartDisabled: true,
  muted: false,
  muteVisible: false,
};

export function App() {
  const store = useMemo(() => createUiStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [controller, setController] = useState<GameController | null>(null);
  const [controllerSnapshot, setControllerSnapshot] = useState<ControllerSnapshot>(defaultControllerSnapshot);

  useEffect(() => {
    if (!controller) return;
    setControllerSnapshot(controller.getSnapshot());
    return controller.subscribe(() => setControllerSnapshot(controller.getSnapshot()));
  }, [controller]);

  const handleReady = useCallback((nextController: GameController) => {
    setController(nextController);
    setControllerSnapshot(nextController.getSnapshot());
  }, []);

  return (
    <>
      <GameShell store={store} onReady={handleReady} />
      <div className="fixed inset-0 z-50 pointer-events-none">
        <GameHud state={state} />
        {controller && (
          <MuteButton
            visible={controllerSnapshot.muteVisible}
            muted={controllerSnapshot.muted}
            onToggle={() => controller.toggleMute()}
          />
        )}
      </div>

      {controller && state.screen === 'title' && (
        <TitleScreen
          controller={controller}
          playerName={controllerSnapshot.playerName}
          defaultGameMode={controller.getSettingsValues().gameMode}
        />
      )}
      {controller && state.screen === 'settings' && (
        <SettingsScreen controller={controller} returnMode={controllerSnapshot.settingsReturnMode} />
      )}
      {controller && state.screen === 'lobby' && (
        <LobbyScreen
          controller={controller}
          room={state.room}
          isHost={controllerSnapshot.isRoomHost}
          locked={controllerSnapshot.roomSettingsLocked}
          startLabel={controllerSnapshot.roomStartLabel}
          startDisabled={controllerSnapshot.roomStartDisabled}
        />
      )}
      {controller && state.screen === 'ranking' && (
        <RankingScreen
          controller={controller}
          entries={state.rankingEntries}
          detail={state.rankingDetail}
        />
      )}
      {controller && state.screen === 'pause' && (
        <PauseScreen controller={controller} />
      )}
      {controller && state.screen === 'gameover' && (
        <GameOverScreen controller={controller} gameOver={state.gameOver} />
      )}

      {state.error && (
        <div className="fixed left-1/2 top-5 z-[250] -translate-x-1/2 rounded-lg border border-red-300/40 bg-red-950/70 px-4 py-2 text-sm font-bold text-red-100 shadow-2xl backdrop-blur">
          {state.error}
        </div>
      )}
    </>
  );
}
