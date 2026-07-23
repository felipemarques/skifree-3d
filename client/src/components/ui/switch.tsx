import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    role="switch"
    className={cn('h-5 w-9 cursor-pointer accent-[#2d7fff] disabled:cursor-not-allowed disabled:opacity-55', className)}
    {...props}
  />
));
Switch.displayName = 'Switch';

export { Switch };
