import { ArrowLeft, Play, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import type { GameController } from '@/app/gameController';
import type { RoomSettings, RoomState } from '@/types/app';
import { ScreenFrame } from './ScreenFrame';

interface LobbyScreenProps {
  controller: GameController;
  room: RoomState;
  isHost: boolean;
  locked: boolean;
  startLabel: string;
  startDisabled: boolean;
}

export function LobbyScreen({ controller, room, isHost, locked, startLabel, startDisabled }: LobbyScreenProps) {
  const names = room.players.map(player => player.name || 'Player').join(', ');
  const settings = room.settings;
  const update = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) => {
    controller.updateRoomSettings({ [key]: value });
  };

  return (
    <ScreenFrame panelClassName="text-center">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Room Lobby</div>
      <div className="text-[clamp(36px,10vw,58px)] font-black tracking-[0.2em] text-cyan-200 drop-shadow-[0_12px_36px_rgba(121,231,255,0.28)]">
        {room.roomId || '------'}
      </div>
      <div className="text-sm text-[#aab9cf]">Share this code with friends</div>

      <div className="flex items-center justify-center gap-2 text-sm text-[#aab9cf]">
        <Users className="h-4 w-4 text-cyan-300" />
        Players in room: {names || 'waiting'} ({room.players.length}/8)
      </div>

      {room.countdown !== null && (
        <div className="mx-auto w-[min(210px,100%)] rounded-lg border border-cyan-300/40 bg-blue-500/15 px-4 py-3 text-lg font-black text-white shadow-[0_0_24px_rgba(39,132,255,0.22)]">
          {room.countdown > 0 ? `Starting in ${room.countdown}` : 'Go!'}
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-white/15 bg-white/[0.055] p-3 text-left">
        <div className="flex justify-between gap-3 text-xs font-black uppercase tracking-[0.08em] text-cyan-300">
          <span>Room Settings</span>
          <span>{room.countdown !== null ? 'Starting' : isHost ? 'You are host' : 'Host controls'}</span>
        </div>

        <label className="grid gap-2 text-sm font-bold text-[#dbeaff]">
          Game Mode
          <Select disabled={locked} value={settings.gameMode} onChange={event => update('gameMode', event.target.value as RoomSettings['gameMode'])}>
            <option value="classic">Classic / Arcade</option>
            <option value="sky_mario">Sky Mario</option>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-bold text-[#dbeaff]">
          Difficulty
          <Select disabled={locked} value={settings.difficulty} onChange={event => update('difficulty', event.target.value as RoomSettings['difficulty'])}>
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
            <option value="extreme">Extreme</option>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-bold text-[#dbeaff]">
          Yeti Mode
          <Select disabled={locked} value={settings.yetiStartMode} onChange={event => update('yetiStartMode', event.target.value as RoomSettings['yetiStartMode'])}>
            <option value="distance">Distance Trigger</option>
            <option value="immediate">Hunt From Start</option>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-bold text-[#dbeaff]">
          <span className="flex justify-between">
            Obstacles
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-extrabold text-cyan-300">
              {Math.round(Number(settings.obstacleVolume) * 100)}%
            </span>
          </span>
          <Slider disabled={locked} min={0} max={2} step={0.1} value={settings.obstacleVolume} onChange={event => update('obstacleVolume', Number(event.target.value))} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" disabled={startDisabled} onClick={() => controller.startRoomGame()}>
          <Play className="h-4 w-4" />
          {startLabel}
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.leaveRoom()}>
          <ArrowLeft className="h-4 w-4" />
          Leave
        </Button>
      </div>
    </ScreenFrame>
  );
}
