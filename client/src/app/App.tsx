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
import { HowToPlayScreen } from '@/components/screens/HowToPlayScreen';
import { GameHud } from '@/components/hud/GameHud';
import { settings } from '@/utils/Settings';
import { COMPACT_LANDSCAPE_QUERY } from '@/utils/touch';
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
  playerColor: '#2979ff',
};

export function App() {
  const store = useMemo(() => createUiStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [controller, setController] = useState<GameController | null>(null);
  const [controllerSnapshot, setControllerSnapshot] = useState<ControllerSnapshot>(defaultControllerSnapshot);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useEffect(() => {
    if (state.screen !== 'title' || settings.get('hasSeenTutorial')) return;
    settings.set('hasSeenTutorial', true);
    setShowHowToPlay(true);
  }, [state.screen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(COMPACT_LANDSCAPE_QUERY);
    const apply = () => document.body.classList.toggle('is-compact-landscape', mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

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
        <GameHud state={state} controller={controller} />
      </div>

      {controller && state.screen === 'title' && (
        <TitleScreen
          controller={controller}
          playerName={controllerSnapshot.playerName}
          defaultGameMode={controller.getSettingsValues().gameMode}
          onShowHowToPlay={() => setShowHowToPlay(true)}
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
        <PauseScreen controller={controller} multiplayer={controllerSnapshot.isMultiplayer} />
      )}
      {controller && state.screen === 'gameover' && (
        <GameOverScreen controller={controller} gameOver={state.gameOver} />
      )}

      {state.error && (
        <div className="fixed left-1/2 top-5 z-[250] -translate-x-1/2 rounded-lg border border-red-300/40 bg-red-950/70 px-4 py-2 text-sm font-bold text-red-100 shadow-2xl backdrop-blur">
          {state.error}
        </div>
      )}

      {state.notice && (
        <div className="fixed left-1/2 top-5 z-[250] -translate-x-1/2 rounded-lg border border-emerald-300/40 bg-emerald-950/70 px-4 py-2 text-sm font-bold text-emerald-100 shadow-2xl backdrop-blur">
          {state.notice}
        </div>
      )}

      {showHowToPlay && <HowToPlayScreen onClose={() => setShowHowToPlay(false)} />}
    </>
  );
}
