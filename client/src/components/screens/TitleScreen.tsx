import { useEffect, useState } from 'react';
import { Play, Save, Settings, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Brand, ScreenFrame, Section } from './ScreenFrame';
import type { GameController } from '@/app/gameController';
import type { GameMode } from '@/types/app';

interface TitleScreenProps {
  controller: GameController;
  playerName: string;
  defaultGameMode: GameMode;
}

export function TitleScreen({ controller, playerName, defaultGameMode }: TitleScreenProps) {
  const [name, setName] = useState(playerName);
  const [roomCode, setRoomCode] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>(defaultGameMode || 'classic');

  useEffect(() => setName(playerName), [playerName]);

  return (
    <ScreenFrame>
      <Brand eyebrow="Arcade Alpine" subtitle="Multiplayer Edition" />

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
        </div>
      </Section>

      <Section title="Multiplayer">
        <Button type="button" onClick={() => controller.createRoom(name, gameMode)}>
          <Users className="h-4 w-4" />
          Create Room
        </Button>
        <div className="grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1">
          <Input
            value={roomCode}
            maxLength={6}
            placeholder="ROOM"
            className="text-center uppercase tracking-[0.18em]"
            onChange={event => setRoomCode(event.target.value.toUpperCase())}
          />
          <Button variant="secondary" type="button" onClick={() => controller.joinRoom(roomCode, name)}>
            Join
          </Button>
        </div>
      </Section>

      <div className="grid gap-2">
        <Button variant="secondary" type="button" onClick={() => controller.showRankingScreen()}>
          <Trophy className="h-4 w-4" />
          Ranking
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.openSettings('title')}>
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>
    </ScreenFrame>
  );
}
