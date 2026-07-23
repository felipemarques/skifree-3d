import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="range"
    className={cn('h-2 w-full cursor-pointer accent-[#65b8ff] disabled:cursor-not-allowed disabled:opacity-55', className)}
    {...props}
  />
));
Slider.displayName = 'Slider';

export { Slider };
