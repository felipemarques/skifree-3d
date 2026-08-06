import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScreenFrame } from './ScreenFrame';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function Key({ children }: { children: string }) {
  return (
    <span className="min-w-5 shrink-0 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-center text-[10px] font-black text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)]">
      {children}
    </span>
  );
}

function Badge({ className, children }: { className: string; children: string }) {
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function Row({ badge, children }: { badge: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {badge}
      <span className="text-xs text-[#c7d6ea]">{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div className="text-xs font-black uppercase tracking-[0.12em] text-cyan-300">{children}</div>;
}

export function HowToPlayScreen({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the close button on open, restore whatever had focus before
    // (the title-screen button that opened this) once it closes - a
    // keyboard user shouldn't lose their place in the underlying screen.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
      <ScreenFrame panelClassName="w-[min(760px,calc(100vw-40px))] text-left">
        <div className="flex items-center justify-between">
          <h2 id="how-to-play-title" className="text-xl font-black text-white">How to Play</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

      {/* Two columns above mobile width halves this content's natural
          height compared to stacking all 5 sections in one column - a wider
          panel (above) reads better than a tall, narrow scrolling reference
          card. max-h/ScrollArea below stays as a fallback for genuinely
          short viewports, not the primary way this content is reached. */}
      <ScrollArea className="max-h-[80vh] pr-1">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <SectionTitle>Controls</SectionTitle>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs font-bold text-[#deeeff]">
              <div className="flex items-center gap-1.5"><Key>A / D</Key> Turn</div>
              <div className="flex items-center gap-1.5"><Key>W</Key> Brake</div>
              <div className="flex items-center gap-1.5"><Key>S / Shift</Key> Boost</div>
              <div className="flex items-center gap-1.5"><Key>Space</Key> Jump</div>
              <div className="flex items-center gap-1.5"><Key>Mouse</Key> Steer / speed</div>
              <div className="flex items-center gap-1.5"><Key>Esc</Key> Pause</div>
            </div>
          </div>

          <div className="grid gap-2">
            <SectionTitle>Objective</SectionTitle>
            <p className="text-xs leading-relaxed text-[#c7d6ea]">
              Ski as far downhill as you can without running out of hearts. Trees, rocks, and holes cost a heart on impact;
              ramps launch you into the air. A yeti eventually joins the chase - outrun it or it's game over.
            </p>
          </div>

          <div className="grid gap-2">
            <SectionTitle>Skill Scoring</SectionTitle>
            <p className="text-xs leading-relaxed text-[#c7d6ea]">When enabled, playing risky pays off in extra distance:</p>
            <Row badge={<Badge className="border-amber-300/50 bg-amber-500/10 text-amber-100">Chain x2</Badge>}>
              Ramp jumps in quick succession chain together for bonus distance - staying fast extends the window.
            </Row>
            <Row badge={<Badge className="border-white/15 bg-white/10 text-[#dceeff]">Clean Run</Badge>}>
              Going a while without getting hit builds a steadily growing distance bonus.
            </Row>
            <Row badge={<Badge className="border-red-300/50 bg-red-600/25 text-red-100">Yeti Danger Bonus</Badge>}>
              Surviving deep in the yeti's danger range pays out extra distance the longer you last.
            </Row>
            <p className="text-xs leading-relaxed text-[#c7d6ea]">
              Grazing an obstacle without hitting it, and keeping your speed up, also add smaller bonuses on top.
            </p>
          </div>

          <div className="grid gap-2">
            <SectionTitle>Weather</SectionTitle>
            <Row badge={<Badge className="border-slate-200/40 bg-slate-400/15 text-slate-100">Blizzard</Badge>}>
              Visibility drops - the track ahead gets harder to read.
            </Row>
            <Row badge={<Badge className="border-cyan-200/50 bg-cyan-500/15 text-cyan-100">Icy</Badge>}>
              Steering and braking get noticeably sluggish - ease off the stick and give yourself room to turn.
            </Row>
          </div>

          <div className="grid gap-2">
            <SectionTitle>Extras</SectionTitle>
            <p className="text-xs leading-relaxed text-[#c7d6ea]">
              <span className="font-black text-white">Race Ghost</span> replays your best solo run as a translucent rival on
              its exact track. <span className="font-black text-white">Daily Challenge</span> puts everyone on the same seed
              for the day, with its own leaderboard.
            </p>
          </div>
        </div>
      </ScrollArea>

        <Button type="button" onClick={onClose}>
          Got it
        </Button>
      </ScreenFrame>
    </div>
  );
}
