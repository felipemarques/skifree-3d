import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-white/15 bg-white/10 text-[#dceeff]',
        cyan: 'border-cyan-300/40 bg-cyan-300/10 text-cyan-200',
        danger: 'border-red-300/40 bg-red-500/15 text-red-100',
        gold: 'border-yellow-300/40 bg-yellow-300/15 text-yellow-100',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
