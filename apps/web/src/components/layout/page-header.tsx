import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** Portion of the title rendered with brand gradient. Defaults to the last word. */
  highlight?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  badge?: string;
}

function splitTitle(title: string, highlight?: string) {
  const accent = highlight?.trim() || title.trim().split(/\s+/).slice(-1)[0] || title;
  const idx = title.lastIndexOf(accent);
  if (idx < 0) return { prefix: title, accent };
  return {
    prefix: title.slice(0, idx).trimEnd(),
    accent: title.slice(idx),
  };
}

export function PageHeader({ title, highlight, description, children, className, badge }: PageHeaderProps) {
  const { prefix, accent } = splitTitle(title, highlight);

  return (
    <div className={cn('hero-banner', className)}>
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          {badge && (
            <span className="inline-flex rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
              {badge}
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            {prefix ? <>{prefix}{' '}</> : null}
            <span className="gradient-text">{accent}</span>
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
        {children && (
          <div className="flex flex-wrap items-center gap-2.5">{children}</div>
        )}
      </div>
    </div>
  );
}
