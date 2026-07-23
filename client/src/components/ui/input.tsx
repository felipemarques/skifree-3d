import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'min-h-11 w-full rounded-lg border border-white/20 bg-white/[0.075] px-3 text-sm font-bold text-white outline-none transition placeholder:text-white/40 focus:border-cyan-300/80 focus:bg-white/10 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-55',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
