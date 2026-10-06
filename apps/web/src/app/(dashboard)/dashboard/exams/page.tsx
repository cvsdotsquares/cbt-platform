'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { curriculumApi, examsApi, type ExamListItem } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { PageHeader } from '@/components/layout/page-header';
import { HorizontalTabScroller, ScrollableListPanel } from '@/components/layout/horizontal-tab-scroller';
import { EmptyState } from '@/components/layout/data-table';
import { ExamAssignCandidatesDialog } from '@/components/admin/exam-assign-candidates-dialog';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_EXAM_TIMEZONE,
  DEFAULT_PAST_START_GRACE_MINUTES,
  addMinutesToLocalDateTime,
  getDefaultExamScheduleValues,
  localDateTimeToUtcIso,
  nowLocalDateTimeInput,
  parseExamDateTime,
  utcIsoToLocalDateTimeInput,
  validateExamSchedule,
} from '@cbt/shared';
import { formatExamTimeRange } from '@/lib/exam-dates';
import { FileText, Users, Clock, HelpCircle, GraduationCap, Search, Filter, X } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { buildSubjectNameLookup, classTestSubjectLabel } from '@/lib/class-test-subject-label';
import {
  CLASS_TEST_DELETE_BLOCKED_TITLE,
  classTestDeleteBlockedReason,
} from '@/lib/class-test-delete';
import {
  classTestAssignedStudentCount,
  classTestAttemptedStudentCount,
  formatClassTestStudentAttemptSummary,
} from '@/lib/class-test-student-counts';

type ExamItem = ExamListItem;

function questionCount(exam: ExamItem) {
  return (exam.sections || []).reduce((sum, s) => sum + (s._count?.questions ?? 0), 0);
}

type ClassTab = 'all' | string;
type StatusTab = 'all' | 'published' | 'draft';

function examClassId(exam: ExamItem): string | undefined {
  return exam.aiTestConfig?.batch?.academicClass?.id;
}

function isPublishedExamStatus(status: ExamItem['status']) {
  return status === 'PUBLISHED' || status === 'COMPLETED';
}

function examSubjectId(exam: ExamItem): string | undefined {
  const id = exam.settings?.subjectId ?? exam.aiTestConfig?.subjectId;
  return typeof id === 'string' && id ? id : undefined;
}

const EXAM_FILTER_FIELD =
  'flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function ExamsPage() {
  const searchParams = useSearchParams();
  const highlightExamId = searchParams.get('exam');
  const { accessToken } = useRequireAuth(true);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [candidatesDialog, setCandidatesDialog] = useState<{ examId: string; title: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; code: string } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ExamItem | null>(null);
  const [scheduleAlert, setScheduleAlert] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [classTab, setClassTab] = useState<ClassTab>('all');
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [scheduleForm, setScheduleForm] = useState(() => {
    const defaults = getDefaultExamScheduleValues(DEFAULT_EXAM_TIMEZONE, 30, new Date());
    return {
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      timezone: defaults.timezone,
      durationMinutes: defaults.durationMinutes,
      passingScore: 40,
    };
  });

  const { data, isLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{
      id: string; level: number; name: string;
      subjects: { id: string; name: string }[];
    }[]>,
    enabled: !!accessToken,
  });

  const sortedClasses = useMemo(
    () => [...(classes ?? [])].sort((a, b) => a.level - b.level),
    [classes],
  );

  const subjectNameById = useMemo(() => buildSubjectNameLookup(classes ?? []), [classes]);

  useEffect(() => {
    setBatchFilter('');
    setSubjectFilter('');
  }, [classTab]);

  useEffect(() => {
    if (!filterPanelOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!filterPanelRef.current?.contains(event.target as Node)) {
        setFilterPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [filterPanelOpen]);

  useEffect(() => {
    if (!highlightExamId) return;
    setHighlightedId(highlightExamId);
    const el = document.getElementById(`exam-row-${highlightExamId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightedId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightExamId, data]);

  const scheduleWindowMinutes = useMemo(() => {
    if (!scheduleForm.startTime || !scheduleForm.endTime) return null;
    try {
      const start = parseExamDateTime(scheduleForm.startTime, scheduleForm.timezone);
      const end = parseExamDateTime(scheduleForm.endTime, scheduleForm.timezone);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return Math.round((end.getTime() - start.getTime()) / 60_000);
    } catch {
      return null;
    }
  }, [scheduleForm.startTime, scheduleForm.endTime, scheduleForm.timezone]);

  const scheduleValidation = useMemo(() => {
    if (!scheduleForm.startTime || !scheduleForm.endTime) {
      return { ok: false as const, message: 'Choose both start and end times.' };
    }
    if (!scheduleForm.durationMinutes || scheduleForm.durationMinutes < 1) {
      return { ok: false as const, message: 'Duration must be at least 1 minute.' };
    }
    try {
      const start = parseExamDateTime(scheduleForm.startTime, scheduleForm.timezone);
      const end = parseExamDateTime(scheduleForm.endTime, scheduleForm.timezone);
      return validateExamSchedule(start, end, scheduleForm.durationMinutes, {
        disallowPastStart: true,
        timeZone: scheduleForm.timezone,
      });
    } catch {
      return { ok: false as const, message: 'Start and end times must be valid dates.' };
    }
  }, [scheduleForm]);

  const startInPast = useMemo(() => {
    if (!scheduleForm.startTime) return false;
    try {
      const start = parseExamDateTime(scheduleForm.startTime, scheduleForm.timezone);
      const now = new Date();
      const graceMs = DEFAULT_PAST_START_GRACE_MINUTES * 60_000;
      const startLocal = new Intl.DateTimeFormat('en-US', {
        timeZone: scheduleForm.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(start);
      const nowLocal = new Intl.DateTimeFormat('en-US', {
        timeZone: scheduleForm.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const get = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? '0';
      const startWall = Date.UTC(
        Number(get(startLocal, 'year')),
        Number(get(startLocal, 'month')) - 1,
        Number(get(startLocal, 'day')),
        Number(get(startLocal, 'hour')),
        Number(get(startLocal, 'minute')),
      );
      const nowWall = Date.UTC(
        Number(get(nowLocal, 'year')),
        Number(get(nowLocal, 'month')) - 1,
        Number(get(nowLocal, 'day')),
        Number(get(nowLocal, 'hour')),
        Number(get(nowLocal, 'minute')),
      );
      return startWall < nowWall - graceMs;
    } catch {
      return false;
    }
  }, [scheduleForm.startTime, scheduleForm.timezone]);

  const durationExceedsWindow = useMemo(() => {
    if (scheduleWindowMinutes == null) return false;
    return scheduleForm.durationMinutes > scheduleWindowMinutes;
  }, [scheduleForm.durationMinutes, scheduleWindowMinutes]);

  const durationWindowMismatch = useMemo(() => {
    if (scheduleWindowMinutes == null) return false;
    return scheduleForm.durationMinutes !== scheduleWindowMinutes;
  }, [scheduleForm.durationMinutes, scheduleWindowMinutes]);

  const scheduleIssueMessage = useMemo(() => {
    if (startInPast) {
      return 'Start time cannot be in the past. Choose a future start time.';
    }
    if (!durationWindowMismatch || scheduleWindowMinutes == null) return null;
    if (durationExceedsWindow) {
      return `Duration exceeds the exam window. Duration is ${scheduleForm.durationMinutes} min, but start–end is only ${scheduleWindowMinutes} min. Increase the end time or reduce the duration.`;
    }
    return `Duration and exam window do not match. Duration is ${scheduleForm.durationMinutes} min, but start–end spans ${scheduleWindowMinutes} min. Set end time to start + ${scheduleForm.durationMinutes} min, or update the duration.`;
  }, [
    startInPast,
    durationWindowMismatch,
    durationExceedsWindow,
    scheduleForm.durationMinutes,
    scheduleWindowMinutes,
  ]);

  const startTimeMin = nowLocalDateTimeInput(scheduleForm.timezone);

  const endTimeMin = scheduleForm.startTime
    ? addMinutesToLocalDateTime(scheduleForm.startTime, 1, scheduleForm.timezone)
    : undefined;

  const publishMutation = useMutation({
    mutationFn: (id: string) => examsApi.publish(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      toast({ title: 'Class test published', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Cannot publish', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => examsApi.remove(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      setDeleteTarget(null);
      toast({ title: 'Class test deleted.', variant: 'success' });
    },
    onError: (e: Error) => toast({
      title: CLASS_TEST_DELETE_BLOCKED_TITLE,
      description: e.message,
      variant: 'destructive',
    }),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => examsApi.updateSchedule(accessToken!, scheduleTarget!.id, {
      startTime: localDateTimeToUtcIso(scheduleForm.startTime, DEFAULT_EXAM_TIMEZONE),
      endTime: localDateTimeToUtcIso(scheduleForm.endTime, DEFAULT_EXAM_TIMEZONE),
      timezone: DEFAULT_EXAM_TIMEZONE,
      durationMinutes: scheduleForm.durationMinutes,
      passingScore: scheduleForm.passingScore,
      maxAttempts: 1,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      setScheduleAlert(null);
      setScheduleTarget(null);
      toast({ title: 'Schedule updated', variant: 'success' });
    },
    onError: (e: Error) => {
      setScheduleAlert(e.message);
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    },
  });

  function openScheduleEdit(exam: ExamItem) {
    const duration = typeof exam.settings?.durationMinutes === 'number' && exam.settings.durationMinutes > 0
      ? exam.settings.durationMinutes
      : 30;
    const passingScore = typeof exam.settings?.passingScore === 'number' ? exam.settings.passingScore : 40;
    const tz = DEFAULT_EXAM_TIMEZONE;
    const defaults = getDefaultExamScheduleValues(tz, duration, new Date());
    const startMs = exam.startTime ? new Date(exam.startTime).getTime() : NaN;
    const keepExistingStart = Number.isFinite(startMs) && startMs > Date.now() + 60_000;
    setScheduleAlert(null);
    setScheduleForm({
      startTime: keepExistingStart ? utcIsoToLocalDateTimeInput(exam.startTime, tz) : defaults.startTime,
      endTime: keepExistingStart && exam.endTime
        ? utcIsoToLocalDateTimeInput(exam.endTime, tz)
        : defaults.endTime,
      timezone: tz,
      durationMinutes: duration,
      passingScore,
    });
    setScheduleTarget(exam);
  }

  function updateStartTime(value: string) {
    setScheduleAlert(null);
    setScheduleForm((prev) => {
      const duration = Math.max(1, prev.durationMinutes || 30);
      return {
        ...prev,
        startTime: value,
        endTime: value ? addMinutesToLocalDateTime(value, duration, prev.timezone) : prev.endTime,
      };
    });
  }

  function updateDuration(minutes: number) {
    setScheduleAlert(null);
    const duration = Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : 1;
    setScheduleForm((prev) => ({
      ...prev,
      durationMinutes: duration,
      endTime: prev.startTime
        ? addMinutesToLocalDateTime(prev.startTime, duration, prev.timezone)
        : prev.endTime,
    }));
  }

  function handleSaveSchedule() {
    if (!scheduleForm.startTime || !scheduleForm.endTime) {
      setScheduleAlert('Choose both start and end times.');
      return;
    }
    if (scheduleIssueMessage) {
      setScheduleAlert(scheduleIssueMessage);
      return;
    }
    if (!scheduleValidation.ok) {
      setScheduleAlert(scheduleValidation.message);
      return;
    }
    setScheduleAlert(null);
    scheduleMutation.mutate();
  }

  async function handleDeleteClick(exam: ExamItem) {
    let latest: ExamItem = exam;
    if (accessToken) {
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: ['exams'],
          queryFn: () => examsApi.list(accessToken!),
        });
        latest = (fresh?.items ?? []).find((e) => e.id === exam.id) ?? exam;
      } catch {
        /* use list row */
      }
    }
    const reason = classTestDeleteBlockedReason(latest);
    if (reason) {
      toast({
        title: CLASS_TEST_DELETE_BLOCKED_TITLE,
        description: reason,
        variant: 'destructive',
      });
      return;
    }
    setDeleteTarget({ id: exam.id, title: exam.title, code: exam.code });
  }

  const items = useMemo(
    () => (data?.items || []).filter((exam) => exam.aiTestConfig) as ExamItem[],
    [data],
  );

  const classTabCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const exam of items) {
      const id = examClassId(exam);
      if (id) byClass.set(id, (byClass.get(id) ?? 0) + 1);
    }
    return byClass;
  }, [items]);

  const itemsForClass = useMemo(() => {
    if (classTab === 'all') return items;
    return items.filter((exam) => examClassId(exam) === classTab);
  }, [items, classTab]);

  const batchesForFilter = useMemo(() => {
    const byId = new Map<string, NonNullable<NonNullable<ExamItem['aiTestConfig']>['batch']>>();
    for (const exam of itemsForClass) {
      const batch = exam.aiTestConfig?.batch;
      if (batch?.id) byId.set(batch.id, batch);
    }
    return [...byId.values()].sort((a, b) => {
      const levelDiff = a.academicClass.level - b.academicClass.level;
      if (levelDiff !== 0) return levelDiff;
      return a.name.localeCompare(b.name);
    });
  }, [itemsForClass]);

  const subjectsForFilter = useMemo(() => {
    const byId = new Map<string, string>();
    for (const exam of itemsForClass) {
      const id = examSubjectId(exam);
      if (!id) continue;
      const name = subjectNameById.get(id) ?? classTestSubjectLabel(exam, subjectNameById);
      byId.set(id, name);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [itemsForClass, subjectNameById]);

  const scopeFiltersActive = Boolean(batchFilter || subjectFilter);

  const itemsAfterScopeFilters = useMemo(() => {
    let list = itemsForClass;
    if (batchFilter) {
      list = list.filter((exam) => exam.aiTestConfig?.batch?.id === batchFilter);
    }
    if (subjectFilter) {
      list = list.filter((exam) => examSubjectId(exam) === subjectFilter);
    }
    return list;
  }, [itemsForClass, batchFilter, subjectFilter]);

  const publishedTestCount = useMemo(
    () => itemsAfterScopeFilters.filter((e) => isPublishedExamStatus(e.status)).length,
    [itemsAfterScopeFilters],
  );
  const draftTestCount = useMemo(
    () => itemsAfterScopeFilters.filter((e) => e.status === 'DRAFT').length,
    [itemsAfterScopeFilters],
  );

  const itemsForTab = useMemo(() => {
    if (statusTab === 'published') {
      return itemsAfterScopeFilters.filter((e) => isPublishedExamStatus(e.status));
    }
    if (statusTab === 'draft') {
      return itemsAfterScopeFilters.filter((e) => e.status === 'DRAFT');
    }
    return itemsAfterScopeFilters;
  }, [itemsAfterScopeFilters, statusTab]);

  const activeClassMeta = classTab !== 'all' ? sortedClasses.find((c) => c.id === classTab) : undefined;

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return itemsForTab;

    return itemsForTab.filter((exam) => {
      const batch = exam.aiTestConfig?.batch;
      const batchText = [batch?.name, batch?.academicClass?.name].filter(Boolean).join(' ');
      const subjectLabel = classTestSubjectLabel(exam, subjectNameById);
      const haystack = [exam.title, subjectLabel, batchText].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [itemsForTab, searchTerm, subjectNameById]);

  if (isLoading) return <TableSkeleton rows={3} cols={1} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Class Tests"
        highlight="Tests"
        description="Publish and schedule NCERT-aligned tests for your batches. Tests are created from uploaded books via Create Class Test."
        badge="NCERT · Classes 9–12"
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
          <HorizontalTabScroller className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setClassTab('all')}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                classTab === 'all'
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              All classes
              {items.length > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                  classTab === 'all' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                )}>
                  {items.length}
                </span>
              )}
            </button>
            {sortedClasses.map((cls) => {
              const active = classTab === cls.id;
              const count = classTabCounts.get(cls.id) ?? 0;
              return (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => setClassTab(cls.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {cls.name}
                  {count > 0 && (
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      active ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </HorizontalTabScroller>

          <div ref={filterPanelRef} className="relative shrink-0 lg:mx-1">
            <button
              type="button"
              aria-expanded={filterPanelOpen}
              aria-haspopup="dialog"
              onClick={() => setFilterPanelOpen((open) => !open)}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all sm:w-auto',
                filterPanelOpen || scopeFiltersActive
                  ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                  : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              <Filter className="h-4 w-4 shrink-0" />
              Filter
              {scopeFiltersActive && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {[batchFilter, subjectFilter].filter(Boolean).length}
                </span>
              )}
            </button>
            {filterPanelOpen && (
              <div
                role="dialog"
                aria-label="Class test filters"
                className="absolute left-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),18rem)] rounded-xl border border-border/60 bg-card p-4 text-foreground shadow-lg sm:left-1/2 sm:-translate-x-1/2 lg:left-0 lg:translate-x-0"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Filter tests
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    aria-label="Close filters"
                    onClick={() => setFilterPanelOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Batch</Label>
                    <select
                      className={EXAM_FILTER_FIELD}
                      value={batchFilter}
                      onChange={(e) => setBatchFilter(e.target.value)}
                    >
                      <option value="">All batches</option>
                      {batchesForFilter.map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {batch.academicClass.name} · {batch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Subject</Label>
                    <select
                      className={EXAM_FILTER_FIELD}
                      value={subjectFilter}
                      onChange={(e) => setSubjectFilter(e.target.value)}
                    >
                      <option value="">All subjects</option>
                      {subjectsForFilter.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {scopeFiltersActive && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setBatchFilter('');
                        setSubjectFilter('');
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex w-full flex-col gap-2 lg:ml-auto lg:w-auto lg:flex-row lg:items-center lg:gap-2">
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setStatusTab((s) => (s === 'published' ? 'all' : 'published'))}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                  statusTab === 'published'
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                Published
                {publishedTestCount > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    statusTab === 'published' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                  )}>
                    {publishedTestCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStatusTab((s) => (s === 'draft' ? 'all' : 'draft'))}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                  statusTab === 'draft'
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                Draft
                {draftTestCount > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    statusTab === 'draft' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                  )}>
                    {draftTestCount}
                  </span>
                )}
              </button>
            </div>
            <div className="relative w-full max-w-sm sm:w-auto sm:min-w-[12rem] sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search class tests..."
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <ScrollableListPanel maxHeightClass="max-h-[min(70vh,720px)]" className="space-y-4">
        {filteredItems.map((exam) => {
          const qCount = questionCount(exam);
          const cCount = classTestAssignedStudentCount(exam);
          const attemptedCount = classTestAttemptedStudentCount(exam);
          const batch = exam.aiTestConfig?.batch;
          const readyToPublish = qCount > 0 && cCount > 0;

          return (
            <Card
              key={exam.id}
              id={`exam-row-${exam.id}`}
              className={cn(
                'surface-card group transition-shadow',
                highlightedId === exam.id && 'ring-2 ring-primary shadow-lg',
              )}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{exam.title}</h3>
                      <Badge variant={exam.status === 'PUBLISHED' ? 'success' : 'warning'}>{exam.status}</Badge>
                      {batch && (
                        <Badge variant="secondary" className="gap-1 normal-case tracking-normal">
                          <GraduationCap className="h-3 w-3" />
                          {batch.academicClass.name} · {batch.name}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {classTestSubjectLabel(exam, subjectNameById)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><HelpCircle className="h-3 w-3" />{qCount} question{qCount === 1 ? '' : 's'}</span>
                      <span className="flex items-center gap-1" title={formatClassTestStudentAttemptSummary(exam)}>
                        <Users className="h-3 w-3" />
                        {cCount > 0
                          ? `${attemptedCount}/${cCount} attempted`
                          : 'No students assigned'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatExamTimeRange(exam.startTime, exam.endTime, exam.timezone || DEFAULT_EXAM_TIMEZONE)}
                      </span>
                    </div>
                    {exam.status === 'DRAFT' && !readyToPublish && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        {qCount === 0 && cCount === 0 && 'Finish question review in Create Test, then manage students here.'}
                        {qCount === 0 && cCount > 0 && 'Questions are added from Create Test — finish review there first.'}
                        {qCount > 0 && cCount === 0 && batch
                          ? `No students selected for ${batch.name}. Open Students to include batch members.`
                          : qCount > 0 && cCount === 0 && 'Select at least one student to publish.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can(Permission.EXAM_UPDATE) && exam.status !== 'COMPLETED' && (
                    <Button size="sm" variant="outline" onClick={() => openScheduleEdit(exam)}>
                      Edit Schedule
                    </Button>
                  )}
                  {exam.status === 'DRAFT' && can(Permission.EXAM_PUBLISH) && (
                    <Button
                      size="sm"
                      onClick={() => publishMutation.mutate(exam.id)}
                      disabled={!readyToPublish || publishMutation.isPending}
                    >
                      Publish
                    </Button>
                  )}
                  {can(Permission.EXAM_ASSIGN_CANDIDATES) && batch
                    && (exam.status === 'DRAFT' || exam.status === 'PUBLISHED' || exam.status === 'SCHEDULED') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCandidatesDialog({ examId: exam.id, title: exam.title })}
                    >
                      Students ({cCount}{attemptedCount > 0 ? ` · ${attemptedCount} attempted` : ''})
                    </Button>
                  )}
                  {can(Permission.EXAM_DELETE) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      title="Permanently delete this class test"
                      onClick={() => void handleDeleteClick(exam)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!filteredItems.length && (
          <Card className="surface-card">
            <EmptyState
              icon={itemsForTab.length === 0 && items.length > 0 ? GraduationCap : FileText}
              title={
                !items.length
                  ? 'No class tests yet'
                  : itemsForTab.length === 0
                    ? statusTab === 'published'
                      ? 'No published class tests'
                      : statusTab === 'draft'
                        ? 'No draft class tests'
                        : activeClassMeta
                          ? `No class tests for ${activeClassMeta.name}`
                          : 'No class tests in this class'
                    : 'No matching class tests'
              }
              description={
                !items.length
                  ? 'Create a NCERT-aligned test from uploaded books — it will appear here for scheduling and publishing to your batch.'
                  : itemsForTab.length === 0
                    ? statusTab !== 'all'
                      ? 'Clear the status filter or pick another class to see more tests.'
                      : 'Create a class test for this grade, or switch to All classes to see every test.'
                    : scopeFiltersActive
                      ? 'Clear batch or subject filters, or try a different search.'
                      : 'Try a different class test name, code, or batch.'
              }
            />
            <div className="flex flex-wrap justify-center gap-3 pb-8">
              {!items.length && (
                <Button asChild>
                  <Link href="/dashboard/ai-tests">Create Class Test</Link>
                </Button>
              )}
              {items.length > 0 && itemsForTab.length === 0 && (
                <>
                  {scopeFiltersActive && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBatchFilter('');
                        setSubjectFilter('');
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                  {statusTab !== 'all' && (
                    <Button variant="outline" onClick={() => setStatusTab('all')}>
                      Show all statuses
                    </Button>
                  )}
                  {classTab !== 'all' && statusTab === 'all' && (
                    <Button variant="outline" onClick={() => setClassTab('all')}>
                      View all classes
                    </Button>
                  )}
                  <Button asChild>
                    <Link href="/dashboard/ai-tests">Create Class Test</Link>
                  </Button>
                </>
              )}
            </div>
          </Card>
        )}
        </ScrollableListPanel>
      </div>

      {candidatesDialog && accessToken && (
        <ExamAssignCandidatesDialog
          accessToken={accessToken}
          examId={candidatesDialog.examId}
          examTitle={candidatesDialog.title}
          open={!!candidatesDialog}
          onOpenChange={(open) => !open && setCandidatesDialog(null)}
        />
      )}

      <Dialog
        open={!!scheduleTarget}
        onOpenChange={(open) => {
          if (!open) {
            setScheduleTarget(null);
            setScheduleAlert(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit class test schedule</DialogTitle>
            <DialogDescription>
              Update timing for <span className="font-medium">{scheduleTarget?.title}</span>.
              End time must match start + duration (e.g. 30 min from 5:00 → end 5:30).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={scheduleForm.durationMinutes}
                onChange={(e) => updateDuration(parseInt(e.target.value, 10) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                How long each student gets once they start the test.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Pass score (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={scheduleForm.passingScore}
                onChange={(e) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    passingScore: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input
                type="datetime-local"
                value={scheduleForm.startTime}
                min={startTimeMin}
                onChange={(e) => {
                  const next = e.target.value;
                  updateStartTime(startTimeMin && next && next < startTimeMin ? startTimeMin : next);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Students cannot start until this time. The default is the next 5-minute mark, not the current minute.
              </p>
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input
                type="datetime-local"
                value={scheduleForm.endTime}
                disabled={!scheduleForm.startTime}
                min={endTimeMin}
                onChange={(e) => {
                  setScheduleAlert(null);
                  const next = e.target.value;
                  setScheduleForm({
                    ...scheduleForm,
                    endTime: endTimeMin && next && next < endTimeMin ? endTimeMin : next,
                  });
                }}
              />
              {!scheduleForm.startTime && (
                <p className="text-xs text-muted-foreground">Choose a start time first.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value="India (IST)" readOnly disabled className="bg-muted/40" />
              <p className="text-xs text-muted-foreground">All class tests use Indian Standard Time.</p>
            </div>
            {(scheduleAlert || scheduleIssueMessage) && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                {scheduleAlert || scheduleIssueMessage}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={
                scheduleMutation.isPending
                || !scheduleForm.startTime
                || !scheduleForm.endTime
                || !!scheduleIssueMessage
              }
              onClick={handleSaveSchedule}
            >
              {scheduleMutation.isPending ? 'Saving...' : 'Save schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete class test?</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-medium text-foreground">{deleteTarget?.title}</span>?
              This removes all questions and student assignments for this test.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete exam'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
