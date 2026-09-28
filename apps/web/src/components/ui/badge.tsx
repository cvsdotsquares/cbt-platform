import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-primary/10 text-primary border border-primary/20',
    secondary: 'bg-secondary text-secondary-foreground',
    destructive: 'bg-red-500/10 text-red-600 border border-red-500/20 dark:text-red-400',
    outline: 'border border-input bg-background text-foreground',
    success: 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-700 border border-amber-500/20 dark:text-amber-400',
  };
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
