'use client';

import { cn } from '@/lib/utils';

/** Horizontal pill tabs with visible scrollbar when overflowed. */
export function HorizontalTabScroller({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'app-scrollbar flex max-w-full gap-2 overflow-x-auto pb-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Vertical scroll region for long lists inside cards/panels. */
export function ScrollableListPanel({
  children,
  className,
  maxHeightClass = 'max-h-56',
}: {
  children: React.ReactNode;
  className?: string;
  maxHeightClass?: string;
}) {
  return (
    <div className={cn('app-scrollbar overflow-y-auto pr-1', maxHeightClass, className)}>
      {children}
    </div>
  );
}
