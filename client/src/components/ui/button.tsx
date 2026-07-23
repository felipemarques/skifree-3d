import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-5 text-sm font-extrabold transition hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-gradient-to-b from-[#338cff] to-[#1f6fff] text-white shadow-[0_10px_28px_rgba(45,127,255,0.28)] hover:shadow-[0_14px_36px_rgba(45,127,255,0.36)]',
        secondary: 'border-white/20 bg-white/10 text-white hover:bg-white/15',
        ghost: 'border-transparent bg-transparent text-white hover:bg-white/10',
        destructive: 'border-transparent bg-[#ff5d64] text-white hover:bg-[#ff7077]',
      },
      size: {
        default: 'h-11',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-7 text-base',
        icon: 'h-11 w-11 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
