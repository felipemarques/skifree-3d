import type { BonusPopup } from '@/types/app';

const TONE_CLASS: Record<BonusPopup['tone'], string> = {
  positive: 'text-emerald-300 drop-shadow-[0_2px_6px_rgba(16,185,129,0.55)]',
  negative: 'text-red-300 drop-shadow-[0_2px_6px_rgba(248,113,113,0.55)]',
  neutral: 'text-cyan-200 drop-shadow-[0_2px_6px_rgba(103,232,249,0.5)]',
};

/** Floating "+4m"-style text that flies up and fades near the player,
 * anchored a bit above screen center where the chase camera keeps the
 * skier framed - alongside (not instead of) the static HUD flash banner,
 * so a bonus reads as something that just happened at the player. */
export function BonusPopups({ popups }: { popups: BonusPopup[] }) {
  if (!popups.length) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-[38%] z-[var(--z-hud-alert)]">
      {popups.map(p => (
        <div
          key={p.id}
          className={`bonus-popup absolute whitespace-nowrap text-lg font-black uppercase tracking-wide ${TONE_CLASS[p.tone]}`}
          style={{ left: `${p.x}px`, top: `${p.y}px` }}
        >
          {p.text}
        </div>
      ))}
    </div>
  );
}
