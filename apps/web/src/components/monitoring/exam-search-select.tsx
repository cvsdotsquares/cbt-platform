'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ExamListItem } from '@/lib/api';

type ExamSearchSelectProps = {
  exams: ExamListItem[];
  value: string;
  onChange: (examId: string) => void;
  loading?: boolean;
  className?: string;
};

const STATUS_ORDER: Record<string, number> = {
  IN_PROGRESS: 0,
  PUBLISHED: 1,
  SCHEDULED: 2,
  DRAFT: 3,
  COMPLETED: 4,
  ARCHIVED: 5,
};

function examLabel(exam: ExamListItem) {
  const code = exam.code?.trim();
  return code ? `${exam.title} (${code})` : exam.title;
}

type PanelPos = { top: number; left: number; width: number };

export function ExamSearchSelect({ exams, value, onChange, loading, className }: ExamSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = exams.find((e) => e.id === value);

  useEffect(() => setMounted(true), []);

  const sorted = useMemo(() => {
    return [...exams].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99;
      const sb = STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  }, [exams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((e) => {
      const hay = `${e.title} ${e.code ?? ''} ${e.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, query]);

  const updatePanelPos = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, 288);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPanelPos({ top: rect.bottom + 8, left, width });
  };

  useEffect(() => {
    if (!open) return;
    updatePanelPos();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', updatePanelPos);
    window.addEventListener('scroll', updatePanelPos, true);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', updatePanelPos);
      window.removeEventListener('scroll', updatePanelPos, true);
      window.clearTimeout(t);
    };
  }, [open]);

  const panel = open && panelPos && mounted ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Choose exam"
      className="fixed z-[200] overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
    >
      <div className="border-b border-border/60 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or code…"
            className="h-9 pl-8"
          />
        </div>
      </div>
      <ul
        className="max-h-64 min-h-[8rem] overflow-y-auto overscroll-contain py-1 [scrollbar-gutter:stable]"
        role="listbox"
        aria-label="Exams"
      >
        <li>
          <button
            type="button"
            className={cn(
              'flex w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60',
              !value && 'bg-muted/50 font-medium text-foreground',
            )}
            onClick={() => {
              onChange('');
              setOpen(false);
              setQuery('');
            }}
          >
            Select exam…
          </button>
        </li>
        {loading ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">Loading exams…</li>
        ) : exams.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">No exams found.</li>
        ) : filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">No exams match &quot;{query.trim()}&quot;.</li>
        ) : (
          filtered.map((exam) => (
            <li key={exam.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === exam.id}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60',
                  value === exam.id && 'bg-primary/10 font-medium',
                )}
                onClick={() => {
                  onChange(exam.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span className="truncate">{exam.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {exam.code ? `${exam.code} · ` : ''}
                  {exam.status.replace(/_/g, ' ')}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {loading ? '…' : `${filtered.length} of ${exams.length} exams`}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-[14rem] sm:w-72', className)}>
      <button
        type="button"
        disabled={loading && exams.length === 0}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) updatePanelPos();
            return next;
          });
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-left text-sm shadow-sm',
          'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          open && 'border-primary ring-2 ring-primary/20',
        )}
      >
        <span className="truncate">
          {loading && exams.length === 0 ? 'Loading exams…' : selected ? examLabel(selected) : 'Select exam…'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {panel && createPortal(panel, document.body)}
    </div>
  );
}
