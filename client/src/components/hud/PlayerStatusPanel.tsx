import type { PlayerStatus } from '@/types/app';

export function PlayerStatusPanel({ players, touchActive = false }: { players: PlayerStatus[]; touchActive?: boolean }) {
  if (!players || players.length <= 1) return null;
  const sorted = [...players].sort((a, b) => (b.distance || 0) - (a.distance || 0));

  // On touch, stay top-right always - the bottom-relocation on narrow
  // screens would otherwise land on top of the jump button/D-pad
  // (TouchControls.tsx).
  const positionClass = touchActive ? 'right-2.5 top-2.5' : 'right-4 top-4 max-sm:bottom-[150px] max-sm:right-2.5 max-sm:top-auto';

  return (
    <div className={`hud-glass pointer-events-none fixed z-[60] min-w-44 max-w-[min(280px,calc(100vw-40px))] p-3 text-right text-sm leading-normal text-[#dceeff] ${positionClass}`}>
      {sorted.map((player, index) => {
        const alive = player.alive !== false;
        return (
          <div key={`${player.id || player.name}-${index}`} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2.5 py-0.5">
            <div className="flex min-w-0 items-center gap-1.5 truncate text-left">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/40" style={{ backgroundColor: player.color || '#2979ff' }} />
              <span className="truncate">{index + 1}. {player.name || 'Player'}</span>
            </div>
            <div className="text-right text-[11px] text-white/70">
              <span className={`font-black uppercase ${alive ? 'text-[#7df7ba]' : 'text-[#ff8c98]'}`}>{alive ? 'Playing' : 'Dead'}</span>
              {' - '}
              {Math.round(player.distance || 0)} m
            </div>
          </div>
        );
      })}
    </div>
  );
}
