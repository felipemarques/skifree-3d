import { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { GameController } from '@/app/gameController';
import type { RankingEntry, RankingPlayerSummary } from '@/types/app';
import { getDailyKey } from '@/utils/DailyChallenge';
import { rankingStore } from '@/utils/RankingStore';
import { ScreenFrame } from './ScreenFrame';

interface RankingScreenProps {
  controller: GameController;
  entries: RankingEntry[];
  detail: RankingPlayerSummary | null;
  loading?: boolean;
}

function formatMode(mode: string) {
  return ({
    solo: 'Classic',
    classic: 'Classic',
    multiplayer: 'Multiplayer',
    sky_mario: 'Sky Mario',
    multiplayer_sky_mario: 'Multiplayer Sky Mario',
  } as Record<string, string>)[mode] || 'Classic';
}

function dateText(value: number) {
  return new Date(value).toLocaleDateString();
}

export function RankingScreen({ controller, entries, detail, loading = false }: RankingScreenProps) {
  const [tab, setTab] = useState<'all' | 'today'>('all');
  const [dailyEntries, setDailyEntries] = useState<RankingEntry[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState(false);
  const [dailyRetry, setDailyRetry] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  // Key the "Today" tab off the last Daily Challenge's pinned mode when one
  // exists, not the player's live settings selection — the daily run locked
  // the mode at start time, so changing the title-screen selection must not
  // empty the tab (minor list).
  const mode = controller.getLastDailyMode?.() ?? controller.getSettingsValues().gameMode;

  useEffect(() => {
    if (tab !== 'today') return;
    let cancelled = false;
    setDailyLoading(true);
    setDailyError(false);
    rankingStore.getDaily(mode, getDailyKey(), 20)
      .then(result => {
        if (cancelled) return;
        setDailyEntries(result);
        setDailyLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDailyError(true);
        setDailyLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, mode, dailyRetry]);

  // Auto-dismiss the "Confirm" arm of the Clear button so a stray second
  // click after the window expires can't wipe the leaderboard.
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const displayedEntries = tab === 'today' ? dailyEntries : entries;

  return (
    <ScreenFrame panelClassName="text-center">
      <div className="grid gap-1 text-center">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Best Runs</div>
        <h2 className="text-2xl font-black text-white">Ranking</h2>
      </div>

      {detail ? (
        <RankingDetail controller={controller} detail={detail} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={tab === 'all' ? 'default' : 'secondary'} type="button" onClick={() => setTab('all')}>
              All-Time
            </Button>
            <Button variant={tab === 'today' ? 'default' : 'secondary'} type="button" onClick={() => setTab('today')}>
              Today
            </Button>
          </div>
          {tab === 'today' && dailyError && (
            <div className="my-4 grid gap-2">
              <div className="text-sm text-red-300">Couldn't load today's runs — check your connection.</div>
              <Button variant="secondary" type="button" onClick={() => setDailyRetry(n => n + 1)}>
                Retry
              </Button>
            </div>
          )}
          {tab === 'today' && dailyLoading && !dailyEntries.length && (
            <div className="my-4 text-sm text-[#aab9cf]">Loading today's runs…</div>
          )}
          {tab === 'all' && loading && !displayedEntries.length && (
            <div className="my-4 text-sm text-[#aab9cf]">Loading rankings…</div>
          )}
          {!displayedEntries.length && !dailyError && !dailyLoading && !(tab === 'all' && loading) && (
            <div className="my-4 text-sm text-[#aab9cf]">No runs recorded yet.</div>
          )}
          <ScrollArea className="max-h-[52vh]">
            <div className="grid gap-2 text-left">
              {displayedEntries.map((entry, index) => (
                <div key={`${entry.playerId}-${entry.distance}-${index}`} className="grid grid-cols-[32px_1fr_auto] items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] p-3">
                  <span className="text-center text-base font-black text-cyan-300">{index + 1}</span>
                  <button
                    type="button"
                    className="min-w-0 truncate text-left text-sm font-black text-white hover:text-cyan-300"
                    onClick={() => controller.showRankingDetail(entry.playerId)}
                  >
                    {entry.name}
                  </button>
                  <span className="text-right text-sm font-black text-white">{Math.round(entry.distance)} m</span>
                  <span className="col-span-2 col-start-2 text-[11px] font-bold uppercase tracking-wide text-[#aab9cf]">
                    {formatMode(entry.mode)} - {entry.difficulty} - {dateText(entry.date)} - {Math.round(entry.runCount || 1)} runs
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => controller.mainMenu()}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          variant="secondary"
          type="button"
          className={confirmClear ? 'border-red-400/60 text-red-200' : ''}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            controller.clearRanking();
            // Today's tab is fetched separately (rankingStore.getDaily) and
            // clearRanking() only updates the all-time entries the store
            // passes down - without this, stale "Today" rows keep showing
            // until some unrelated state change happens to re-run the fetch.
            setDailyEntries([]);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          {confirmClear ? 'Confirm - clears all-time & today' : 'Clear'}
        </Button>
      </div>
    </ScreenFrame>
  );
}

function RankingDetail({ controller, detail }: { controller: GameController; detail: RankingPlayerSummary }) {
  return (
    <div className="grid gap-3 text-left">
      <div className="rounded-lg border border-white/15 bg-white/[0.06] p-3">
        <div className="flex items-center gap-2 text-base font-black text-white">
          <Trophy className="h-4 w-4 text-cyan-300" />
          {detail.name || 'Skier'}
        </div>
        <div className="mt-1 text-xs font-extrabold uppercase tracking-wide text-[#aab9cf]">
          {Math.round(detail.runCount || detail.history.length || 0)} runs - best {Math.round(detail.bestDistance || 0)} m
        </div>
      </div>
      <Button variant="secondary" type="button" onClick={() => controller.showRankingOverview()}>
        Back to Ranking
      </Button>
      <div className="text-xs font-black uppercase tracking-[0.1em] text-cyan-300">Last 10 Runs</div>
      <ScrollArea className="max-h-[36vh]">
        <div className="grid gap-2">
          {detail.history.map((entry, index) => (
            <div key={`${entry.date}-${index}`} className="grid grid-cols-[32px_1fr_auto] items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] p-3">
              <span className="text-center text-base font-black text-cyan-300">{index + 1}</span>
              <span className="text-sm font-black text-white">{Math.round(entry.distance)} m</span>
              <span className="text-right text-sm font-bold text-white">{dateText(entry.date)}</span>
              <span className="col-span-2 col-start-2 text-[11px] font-bold uppercase tracking-wide text-[#aab9cf]">
                {formatMode(entry.mode)} - {entry.difficulty}
              </span>
            </div>
          ))}
          {!detail.history.length && <div className="text-sm text-[#aab9cf]">No run history found.</div>}
        </div>
      </ScrollArea>
    </div>
  );
}
