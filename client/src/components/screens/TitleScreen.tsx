import { useEffect, useState } from 'react';
import { CalendarDays, Ghost, HelpCircle, Play, Save, Settings, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Brand, ScreenFrame, Section } from './ScreenFrame';
import type { GameController } from '@/app/gameController';
import type { GameMode } from '@/types/app';
import { ghostStore } from '@/utils/GhostStore';
import { useCompactLandscape } from '@/utils/touch';

interface TitleScreenProps {
  controller: GameController;
  playerName: string;
  defaultGameMode: GameMode;
  onShowHowToPlay: () => void;
  error?: string;
}

export function TitleScreen({ controller, playerName, defaultGameMode, onShowHowToPlay, error }: TitleScreenProps) {
  const [name, setName] = useState(playerName);
  const [roomCode, setRoomCode] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>(defaultGameMode || 'classic');
  // Create/Join Room are fire-and-forget socket emits with no promise to
  // await - this is the only local signal a click actually did something
  // while waiting for room:created/room:joined/room:error. Success
  // navigates away (this screen unmounts), so only the error path needs to
  // clear it explicitly.
  const [pendingRoom, setPendingRoom] = useState<'create' | 'join' | null>(null);
  const difficulty = controller.getSettingsValues().difficulty;
  const ghost = ghostStore.getBest(gameMode, difficulty);
  // A landscape phone has width to spare and height to save - spreading
  // into two columns uses that width instead of leaving it empty either
  // side of a narrow portrait-style card, and (as a bonus) means
  // ScreenFrame's fit-to-scale has less total height to shrink to fit.
  const wide = useCompactLandscape();

  useEffect(() => setName(playerName), [playerName]);
  useEffect(() => {
    if (error) setPendingRoom(null);
  }, [error]);

  return (
    <ScreenFrame panelClassName={wide ? 'w-[min(760px,calc(100vw-40px))]' : undefined}>
      <Brand eyebrow="Arcade Alpine" subtitle="Multiplayer Edition" />

      <div className={wide ? 'grid grid-cols-2 gap-x-6 gap-y-5' : 'contents'}>
        <Section>
          <div className="grid gap-3">
            <div className="grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1">
              <Input value={name} maxLength={16} placeholder="Your name" onChange={event => setName(event.target.value)} />
              <Button variant="secondary" type="button" onClick={() => setName(controller.savePlayerName(name))}>
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
            <Select value={gameMode} onChange={event => setGameMode(event.target.value as GameMode)}>
              <option value="classic">Classic / Arcade</option>
              <option value="sky_mario">Sky Mario</option>
            </Select>
            <Button type="button" onClick={() => controller.startSolo(name, gameMode)}>
              <Play className="h-4 w-4" />
              Play Solo
            </Button>
            {ghost && (
              <Button variant="secondary" type="button" onClick={() => controller.startGhostRace(gameMode, difficulty)}>
                <Ghost className="h-4 w-4" />
                Race Ghost
              </Button>
            )}
            <Button variant="secondary" type="button" onClick={() => controller.startDailyChallenge(gameMode)}>
              <CalendarDays className="h-4 w-4" />
              Daily Challenge
            </Button>
          </div>
        </Section>

        <div className="grid gap-5">
          <Section title="Multiplayer">
            <Button
              type="button"
              disabled={pendingRoom !== null}
              onClick={() => { setPendingRoom('create'); controller.createRoom(name, gameMode); }}
            >
              <Users className="h-4 w-4" />
              {pendingRoom === 'create' ? 'Connecting…' : 'Create Room'}
            </Button>
            <div className="grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1">
              <Input
                value={roomCode}
                maxLength={6}
                placeholder="ROOM"
                className="text-center uppercase tracking-[0.18em]"
                onChange={event => setRoomCode(event.target.value.toUpperCase())}
              />
              <Button
                variant="secondary"
                type="button"
                disabled={pendingRoom !== null}
                onClick={() => { setPendingRoom('join'); controller.joinRoom(roomCode, name); }}
              >
                {pendingRoom === 'join' ? 'Connecting…' : 'Join'}
              </Button>
            </div>
          </Section>

          <div className={wide ? 'grid grid-cols-3 gap-2' : 'grid gap-2'}>
            <Button variant="secondary" type="button" onClick={() => controller.showRankingScreen()}>
              <Trophy className="h-4 w-4" />
              Ranking
            </Button>
            <Button variant="secondary" type="button" onClick={() => controller.openSettings('title')}>
              <Settings className="h-4 w-4" />
              Settings
            </Button>
            <Button variant="secondary" type="button" onClick={onShowHowToPlay}>
              <HelpCircle className="h-4 w-4" />
              How to Play
            </Button>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
