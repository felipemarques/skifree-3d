import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScreenFrameProps {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}

export function ScreenFrame({ children, className, panelClassName }: ScreenFrameProps) {
  return (
    <div className={cn('screen-backdrop pointer-events-auto', className)}>
      <div className={cn('glass-panel grid w-[min(430px,calc(100vw-36px))] gap-5 p-7 text-white', panelClassName)}>
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
