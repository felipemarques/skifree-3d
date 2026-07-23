import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'min-h-11 w-full rounded-lg border border-white/20 bg-white/[0.075] px-3 text-sm font-bold text-white outline-none transition focus:border-cyan-300/80 focus:bg-white/10 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-55 [&_option]:text-slate-950',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export { Select };
