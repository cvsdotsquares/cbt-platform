'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-border/60 bg-muted/80 p-1 shadow-sm',
        'dark:border-white/10 dark:bg-white/[0.06]',
        className,
      )}
      role="group"
      aria-label="Color theme"
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200',
          !isDark
            ? 'bg-card text-amber-500 shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label="Light mode"
        aria-pressed={mounted ? !isDark : undefined}
        title="Light mode"
      >
        <Sun className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200',
          isDark
            ? 'bg-card text-indigo-300 shadow-sm dark:bg-[#7B8FF7] dark:text-white'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label="Dark mode"
        aria-pressed={mounted ? isDark : undefined}
        title="Dark mode"
      >
        <Moon className="h-4 w-4" />
      </button>
    </div>
  );
}
