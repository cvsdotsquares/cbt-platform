import { GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({
  className,
  variant = 'default',
  compact = false,
}: {
  className?: string;
  variant?: 'default' | 'light';
  compact?: boolean;
}) {
  const isLight = variant === 'light';

  const mark = (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center text-white',
        compact ? 'h-11 w-11 rounded-2xl' : 'h-9 w-9 rounded-xl sm:h-10 sm:w-10',
        compact
          ? 'bg-gradient-to-br from-sky-400 via-indigo-400 to-fuchsia-400 shadow-glow-sm'
          : isLight
            ? 'bg-white/10 shadow-inner-glow backdrop-blur-sm'
            : 'gradient-primary shadow-glow',
      )}
    >
      <GraduationCap className={cn(compact ? 'h-5 w-5' : 'h-4 w-4 sm:h-5 sm:w-5')} />
    </div>
  );

  if (compact) {
    return (
      <div className={cn('flex items-center justify-center', className)} title="NCERT Institute">
        {mark}
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5 sm:gap-3', className)}>
      {mark}
      <div className="min-w-0">
        <p
          className={cn(
            'truncate text-sm font-bold leading-none tracking-tight sm:text-[15px]',
            isLight ? 'text-white' : 'text-foreground',
          )}
        >
          NCERT Institute
        </p>
        <p
          className={cn(
            'mt-1 text-[10px] font-semibold uppercase tracking-[0.15em]',
            isLight ? 'text-white/60' : 'text-muted-foreground',
          )}
        >
          Classes 9–12
        </p>
      </div>
    </div>
  );
}
