import * as React from 'react';
import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-3', className)} {...props} />;
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-grid grid-flow-col gap-1 rounded-lg border border-white/15 bg-white/8 p-1', className)} {...props} />;
}

function TabsTrigger({ className, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'rounded-md px-3 py-2 text-sm font-extrabold text-white/70 transition hover:bg-white/10 hover:text-white',
        active && 'bg-white/15 text-white',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
