'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const accentStyles = {
  blue: {
    icon: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400',
    glow: 'group-hover:shadow-[0_0_20px_-4px_hsl(217_91%_60%_/_0.4)]',
    bar: 'from-blue-500 to-blue-400',
    ring: 'group-hover:border-blue-500/30',
    orb: 'bg-blue-500/20',
  },
  green: {
    icon: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    glow: 'group-hover:shadow-[0_0_20px_-4px_hsl(160_84%_39%_/_0.4)]',
    bar: 'from-emerald-500 to-teal-400',
    ring: 'group-hover:border-emerald-500/30',
    orb: 'bg-emerald-500/20',
  },
  amber: {
    icon: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    glow: 'group-hover:shadow-[0_0_20px_-4px_hsl(38_92%_50%_/_0.4)]',
    bar: 'from-amber-500 to-yellow-400',
    ring: 'group-hover:border-amber-500/30',
    orb: 'bg-amber-500/20',
  },
  red: {
    icon: 'bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    glow: 'group-hover:shadow-[0_0_20px_-4px_hsl(0_84%_60%_/_0.4)]',
    bar: 'from-red-500 to-rose-400',
    ring: 'group-hover:border-red-500/30',
    orb: 'bg-red-500/20',
  },
  violet: {
    icon: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    glow: 'group-hover:shadow-[0_0_20px_-4px_hsl(263_70%_50%_/_0.4)]',
    bar: 'from-violet-500 to-purple-400',
    ring: 'group-hover:border-violet-500/30',
    orb: 'bg-violet-500/20',
  },
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  accent?: keyof typeof accentStyles;
  trend?: string;
  trendUp?: boolean;
}

function useCountUp(target: number, duration = 900) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) { setCount(target); return; }
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return count;
}

export function StatCard({ title, value, icon: Icon, accent = 'blue', trend, trendUp }: StatCardProps) {
  const style = accentStyles[accent];
  const isNumeric = typeof value === 'number' && !isNaN(value);
  const animated = useCountUp(isNumeric ? (value as number) : 0);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-[22px] border border-border/40 bg-card',
        'dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-xl',
        'transition-all duration-300 cursor-default select-none',
        'shadow-card',
        style.glow,
        style.ring,
        'hover:-translate-y-0.5 hover:shadow-card-hover',
      )}
    >
      {/* Top gradient bar */}
      <div className={cn('absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r opacity-80', style.bar)} />

      {/* Decorative background orb */}
      <div
        className={cn(
          'absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100',
          style.orb,
        )}
      />

      <div className="relative p-4 pt-5 sm:p-5 sm:pt-6">
        <div className="flex items-start justify-between gap-3">
          {/* Value & label */}
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground sm:text-[12px]">
              {title}
            </p>
            <p
              className={cn(
                'text-2xl font-bold tracking-tight tabular-nums sm:text-3xl',
                'animate-count-up',
              )}
            >
              {isNumeric ? animated.toLocaleString() : value}
            </p>

            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-[11px]',
                  trendUp
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {trendUp ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3 opacity-60" />
                )}
                {trend}
              </span>
            )}
          </div>

          {/* Icon box */}
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
              'transition-all duration-300 group-hover:scale-110 group-hover:rotate-3',
              'sm:h-12 sm:w-12 sm:rounded-2xl',
              style.icon,
            )}
          >
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
      </div>
    </div>
  );
}
