'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, User } from 'lucide-react';
import { analyticsApi, proctoringApi } from '@/lib/api';
import { EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD, formatViolationLabel } from '@cbt/shared';
import { cn } from '@/lib/utils';

function autoSubmitPolicySummary(tabSwitchCount: number, totalViolations: number): string {
  const threshold = EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD;
  return (
    `This attempt allows up to ${threshold} recorded security violations before auto-submit. ` +
    `Current session: ${totalViolations} total violation(s), ${tabSwitchCount} tab switch(es). ` +
    `When violations exceed ${threshold}, the exam is submitted automatically.`
  );
}

export type ViolationDetailResponse = {
  event: {
    id: string;
    eventType: string;
    label: string;
    description: string;
    severity: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  };
  student: {
    candidateId: string;
    name: string;
    email: string;
    registrationNumber?: string | null;
  };
  exam: { id: string; title: string; code: string };
  session: {
    sessionId: string;
    status: string;
    riskScore: number;
    totalViolations: number;
    tabSwitchCount: number;
    autoSubmitThreshold: number;
    autoSubmitTriggered: boolean;
  };
  violationSummary: { eventType: string; label: string; count: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    label: string;
    description: string;
    severity: string;
    occurredAt: string;
  }[];
};

function severityTone(severity: string) {
  const s = severity?.toUpperCase();
  if (s === 'CRITICAL') return 'bg-red-500/15 text-red-700 dark:text-red-400';
  if (s === 'HIGH') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
  if (s === 'MEDIUM') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

type Props = {
  eventId: string | null;
  prefetchedDetail?: ViolationDetailResponse | null;
  accessToken: string | null;
  onOpenChange: (open: boolean) => void;
};

export function ViolationDetailDialog({
  eventId,
  prefetchedDetail,
  accessToken,
  onOpenChange,
}: Props) {
  const open = !!eventId;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['violation-event', eventId],
    queryFn: async () => {
      const id = String(eventId);
      try {
        return (await analyticsApi.violationDetail(
          accessToken!,
          id,
        )) as ViolationDetailResponse;
      } catch {
        return (await proctoringApi.eventDetail(
          accessToken!,
          id,
        )) as ViolationDetailResponse;
      }
    },
    enabled: open && !!accessToken && !!eventId && !prefetchedDetail,
    retry: false,
    initialData: prefetchedDetail ?? undefined,
  });

  const view = prefetchedDetail ?? data;

  const policyText =
    view &&
    autoSubmitPolicySummary(view.session.tabSwitchCount, view.session.totalViolations);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Integrity violation details</DialogTitle>
          <DialogDescription>
            Student, violation type, counts, and session timeline.
          </DialogDescription>
        </DialogHeader>

        {isLoading && !prefetchedDetail && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading violation details…
          </div>
        )}

        {isError && !prefetchedDetail && (
          <div className="space-y-2 py-6 text-center text-sm text-destructive">
            <p>Could not load this violation. It may have been removed or you lack access.</p>
            {error instanceof Error && error.message && (
              <p className="text-xs text-muted-foreground">{error.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Restart the API (port 8000) if you recently updated the app.
            </p>
          </div>
        )}

        {view && (
          <div className="space-y-5 text-sm">
            <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{view.event.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(view.event.occurredAt).toLocaleString()}
                  </p>
                </div>
                <Badge className={cn('shrink-0 border-0', severityTone(view.event.severity))}>
                  {view.event.severity}
                </Badge>
              </div>
              <p className="mt-3 text-muted-foreground">{view.event.description}</p>
            </section>

            <section className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                Student
              </p>
              <div className="rounded-xl border border-border/60 px-4 py-3">
                <p className="font-medium">{view.student.name}</p>
                <p className="text-muted-foreground">{view.student.email}</p>
                {view.student.registrationNumber && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reg. no. {view.student.registrationNumber}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Test: {view.exam.title} ({view.exam.code})
                </p>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/60 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total violations
                </p>
                <p className="text-lg font-bold tabular-nums">{view.session.totalViolations}</p>
              </div>
              <div className="rounded-xl border border-border/60 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Tab switches
                </p>
                <p className="text-lg font-bold tabular-nums">{view.session.tabSwitchCount}</p>
              </div>
            </section>

            {policyText && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground">
                {policyText}
                {view.session.autoSubmitTriggered && (
                  <span className="mt-1 block font-medium text-amber-800 dark:text-amber-300">
                    Auto-submit threshold was exceeded for this session.
                  </span>
                )}
              </p>
            )}

            {view.violationSummary.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Violations by type
                </p>
                <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
                  {view.violationSummary.map((row) => (
                    <li
                      key={row.eventType}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span>{row.label}</span>
                      <Badge variant="secondary" className="tabular-nums">
                        {row.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {view.recentEvents.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Session timeline
                </p>
                <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {view.recentEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className={cn(
                        'rounded-lg border border-border/50 px-3 py-2',
                        ev.id === view.event.id && 'border-primary/40 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{ev.label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(ev.occurredAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{ev.description}</p>
                      {ev.eventType !== ev.label && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                          {formatViolationLabel(ev.eventType)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href={`/dashboard/monitoring?examId=${view.exam.id}`}>
                <Eye className="mr-2 h-3.5 w-3.5" />
                Open live monitoring for this test
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
