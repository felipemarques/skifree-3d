import { ArrowLeft, Crown, Play, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import type { GameController } from '@/app/gameController';
import type { RoomSettings, RoomState } from '@/types/app';
import { ScreenFrame } from './ScreenFrame';
import { PLAYER_COLOR_OPTIONS } from '../../../../shared/AuthoritativeSim';

interface LobbyScreenProps {
  controller: GameController;
  room: RoomState;
  isHost: boolean;
  locked: boolean;
  startLabel: string;
  startDisabled: boolean;
}

export function LobbyScreen({ controller, room, isHost, locked, startLabel, startDisabled }: LobbyScreenProps) {
  const localPlayerId = controller.getSocketId();
  const localPlayer = room.players.find(player => player.id === localPlayerId);
  const selectedColor = localPlayer?.color || controller.getPlayerColor();
  const usedByOthers = new Set(room.players
    .filter(player => player.id !== localPlayerId)
    .map(player => player.color)
    .filter(Boolean));
  const names = room.players.map(player => player.name || 'Player').join(', ');
  const settings = room.settings;
  const update = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) => {
    controller.updateRoomSettings({ [key]: value });
  };

  return (
    <ScreenFrame panelClassName="w-[min(760px,calc(100vw-32px))] gap-4 p-5 text-center md:p-6">
      <div className="grid items-center gap-3 text-left md:grid-cols-[1fr_auto]">
        <div className="grid gap-1">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Room Lobby</div>
          <div className="text-[clamp(34px,7vw,54px)] font-black leading-none tracking-[0.18em] text-cyan-200 drop-shadow-[0_12px_36px_rgba(121,231,255,0.28)]">
            {room.roomId || '------'}
          </div>
          <div className="text-sm text-[#aab9cf]">Share this code with friends</div>
        </div>

        <div className="grid gap-2 text-right max-md:text-left">
          <div className="flex items-center justify-end gap-2 text-sm text-[#aab9cf] max-md:justify-start">
            <Users className="h-4 w-4 text-cyan-300" />
            {room.players.length}/8 players
          </div>
          {room.countdown !== null && (
            <div className="rounded-lg border border-cyan-300/40 bg-blue-500/15 px-4 py-3 text-center text-lg font-black text-white shadow-[0_0_24px_rgba(39,132,255,0.22)]">
              {room.countdown > 0 ? `Starting in ${room.countdown}` : 'Go!'}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(230px,0.85fr)_minmax(0,1.35fr)]">
        <div className="grid content-start gap-3 rounded-lg border border-white/15 bg-white/[0.045] p-3 text-left">
          <div className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.08em] text-cyan-300">
            <span>Players</span>
            <span className="text-[#aab9cf]">{names || 'waiting'}</span>
          </div>
          <div className="grid max-h-[210px] gap-2 overflow-y-auto pr-1">
            {room.players.map(player => (
              <div key={player.id || player.name} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.045] px-3 py-2 text-sm font-bold text-[#dbeaff]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full border border-white/40" style={{ backgroundColor: player.color || '#2979ff' }} />
                  {player.id === room.ownerId && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Host" />}
                  <span className="truncate">{player.name || 'Player'}</span>
                </span>
                {player.id === localPlayerId && <span className="text-[10px] font-black uppercase tracking-[0.08em] text-cyan-300">You</span>}
              </div>
            ))}
          </div>
          <label className="grid gap-2 text-sm font-bold text-[#dbeaff]">
            Outfit Color
            <Select disabled={room.countdown !== null} value={selectedColor} onChange={event => controller.updatePlayerColor(event.target.value)}>
              {PLAYER_COLOR_OPTIONS.map(option => (
                <option key={option.value} value={option.value} disabled={usedByOthers.has(option.value)}>
                  {option.label}{usedByOthers.has(option.value) ? ' - taken' : ''}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="grid content-start gap-3 rounded-lg border border-white/15 bg-white/[0.055] p-3 text-left">
          <div className="flex justify-between gap-3 text-xs font-black uppercase tracking-[0.08em] text-cyan-300">
            <span>Room Settings</span>
            <span>{room.countdown !== null ? 'Starting' : isHost ? 'You are host' : 'Host controls'}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
                <option value="disabled">No Yeti</option>
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
            <div className="grid gap-1">
              <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
                Difficulty Ramp
                <Checkbox disabled={locked} checked={!!settings.difficultyRamp} onChange={event => update('difficultyRamp', event.target.checked)} />
              </label>
              <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Obstacle and ramp density gradually increase the further you ski.</p>
            </div>
            <div className="grid gap-1">
              <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#dbeaff]">
                Skill Scoring
                <Checkbox disabled={locked} checked={!!settings.skillScoring} onChange={event => update('skillScoring', event.target.checked)} />
              </label>
              <p className="text-left text-[11px] leading-snug text-[#7d92ab]">Rewards risky play - ramp chains, clean runs, near misses, and yeti danger all add bonus distance.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:ml-auto md:w-[min(360px,100%)]">
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
