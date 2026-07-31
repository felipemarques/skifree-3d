import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useCompactLandscape } from '@/utils/touch';

interface ScreenFrameProps {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}

const VIEWPORT_MARGIN = 16;

/**
 * Menus must fit entirely inside a short landscape viewport with no
 * scrollbar - a fixed guess-and-check scale would either clip the tallest
 * screens (Settings/Title, a dozen-plus rows) or over-shrink short ones
 * (Pause). Measuring actual content height instead and scaling to fit is
 * the only approach that's correct for every screen without per-screen
 * tuning. transform doesn't affect layout size, so reading scrollHeight
 * stays accurate even while a previous scale is already applied.
 */
function useFitScale(ref: React.RefObject<HTMLElement>, active: boolean) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!active || !ref.current) {
      setScale(1);
      return;
    }
    const el = ref.current;
    const compute = () => {
      const naturalHeight = el.scrollHeight;
      const available = window.innerHeight - VIEWPORT_MARGIN * 2;
      setScale(naturalHeight > 0 ? Math.min(1, available / naturalHeight) : 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [active, ref]);

  return scale;
}

export function ScreenFrame({ children, className, panelClassName }: ScreenFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLandscape();
  const scale = useFitScale(panelRef, compact);

  return (
    <div className={cn('screen-backdrop pointer-events-auto', className)}>
      <div
        ref={panelRef}
        className={cn('glass-panel grid w-[min(430px,calc(100vw-36px))] gap-5 p-7 text-white', panelClassName)}
        style={compact ? { transform: `scale(${scale})`, transformOrigin: 'center' } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export function Brand({ eyebrow, title = 'SKIFREE 3D', subtitle }: { eyebrow: string; title?: string; subtitle?: string }) {
  return (
    <div className="grid gap-1.5 text-center">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">{eyebrow}</div>
      <h1 className="text-[clamp(38px,9vw,64px)] font-black leading-[0.95] tracking-[0.04em] text-[#e9f7ff] drop-shadow-[0_12px_34px_rgba(86,173,255,0.24)]">
        {title}
      </h1>
      {subtitle && <div className="text-sm text-[#aab9cf]">{subtitle}</div>}
    </div>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-white/15 pt-4">
      {title && <div className="text-center text-xs font-extrabold uppercase tracking-[0.12em] text-[#aab9cf]">{title}</div>}
      {children}
    </section>
  );
}
