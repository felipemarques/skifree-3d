import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn('h-5 w-5 cursor-pointer accent-[#2d7fff] disabled:cursor-not-allowed disabled:opacity-55', className)}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
