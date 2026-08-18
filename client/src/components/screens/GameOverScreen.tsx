import { Ghost, Home, RotateCcw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GameController } from '@/app/gameController';
import type { GameOverState } from '@/types/app';
import { ghostStore } from '@/utils/GhostStore';
import { ScreenFrame } from './ScreenFrame';

export function GameOverScreen({ controller, gameOver }: { controller: GameController; gameOver: GameOverState }) {
  const scores = gameOver.scores.length > 1
    ? [...gameOver.scores].sort((a, b) => (b.distance || 0) - (a.distance || 0))
    : [];
  const localScore = gameOver.scores.find(score => score.local);
  const bonusDistance = localScore?.bonusDistance || 0;
  const baseDistance = Math.max(0, gameOver.distance - bonusDistance);
  const ghost = !gameOver.multiplayer ? ghostStore.getBest(gameOver.gameMode, gameOver.difficulty) : null;

  return (
    <ScreenFrame panelClassName="text-center">
      <div className="grid gap-1">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Run Complete</div>
        <h2 className="text-2xl font-black text-white">Game Over</h2>
      </div>
      <div className="text-sm text-[#aab9cf]">Distance Skied</div>
      <div className="text-[clamp(48px,12vw,78px)] font-black text-[#ff6b77] drop-shadow-[0_12px_40px_rgba(45,127,255,0.28)]">
        {Math.round(gameOver.distance)} m
      </div>
      {bonusDistance > 0 && (
        <div className="text-xs font-bold text-[#aab9cf]">
          {Math.round(baseDistance)} m skied <span className="text-cyan-300">+ {Math.round(bonusDistance)} m skill bonus</span>
        </div>
      )}
      {!!scores.length && (
        <div className="grid gap-1 text-sm text-[#dbeaff]">
          <div className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-[#aab9cf]">Room Scores</div>
          {scores.map((score, index) => (
            <div key={`${score.id || score.name}-${index}`}>
              {index + 1}. {score.name || 'Player'} - {Math.round(score.distance || 0)} m
            </div>
          ))}
        </div>
      )}
      {gameOver.ghostSaved && (
        <div className="text-xs font-bold text-cyan-300">New ghost record saved!</div>
      )}
      {gameOver.dailyKey && (
        <div className="text-xs font-bold text-amber-300">Today's Challenge Run</div>
      )}
      {ghost && (
        <Button type="button" onClick={() => controller.startGhostRace(gameOver.gameMode, gameOver.difficulty)}>
          <Ghost className="h-4 w-4" />
          Race Ghost
        </Button>
      )}
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
        <Button type="button" onClick={() => controller.playAgain()}>
          <RotateCcw className="h-4 w-4" />
          Again
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.showRankingScreen()}>
          <Trophy className="h-4 w-4" />
          Ranking
        </Button>
        <Button variant="secondary" type="button" onClick={() => controller.mainMenu()}>
          <Home className="h-4 w-4" />
          Menu
        </Button>
      </div>
    </ScreenFrame>
  );
}
