'use client';

import { useMemo, useState, useEffect } from 'react';
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
import { EXAM_TIMEZONE_OPTIONS, formatExamTimeRange } from '@/lib/exam-dates';
import { FileText, Users, Clock, HelpCircle, GraduationCap, Search } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ExamItem = ExamListItem;

function questionCount(exam: ExamItem) {
  return (exam.sections || []).reduce((sum, s) => sum + (s._count?.questions ?? 0), 0);
}

type ClassTab = 'all' | string;

function examClassId(exam: ExamItem): string | undefined {
  return exam.aiTestConfig?.batch?.academicClass?.id;
}

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
  const [scheduleForm, setScheduleForm] = useState(() => {
    const defaults = getDefaultExamScheduleValues(DEFAULT_EXAM_TIMEZONE, 30, new Date());
    return {
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      timezone: defaults.timezone,
      durationMinutes: defaults.durationMinutes,
      passingScore: 40,
      maxAttempts: 1,
    };
  });

  const { data, isLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{ id: string; level: number; name: string }[]>,
    enabled: !!accessToken,
  });

  const sortedClasses = useMemo(
    () => [...(classes ?? [])].sort((a, b) => a.level - b.level),
    [classes],
  );

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
      toast({ title: 'Class test deleted', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Cannot delete exam', description: e.message, variant: 'destructive' }),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => examsApi.updateSchedule(accessToken!, scheduleTarget!.id, {
      startTime: localDateTimeToUtcIso(scheduleForm.startTime, scheduleForm.timezone),
      endTime: localDateTimeToUtcIso(scheduleForm.endTime, scheduleForm.timezone),
      timezone: scheduleForm.timezone,
      durationMinutes: scheduleForm.durationMinutes,
      passingScore: scheduleForm.passingScore,
      maxAttempts: scheduleForm.maxAttempts,
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
    const maxAttempts = typeof exam.settings?.maxAttempts === 'number' ? exam.settings.maxAttempts : 1;
    const tz = exam.timezone || DEFAULT_EXAM_TIMEZONE;
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
      maxAttempts,
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

  function canDeleteExam(exam: ExamItem) {
    if (exam.status === 'COMPLETED') return false;
    if ((exam._count?.sessions ?? 0) > 0) return false;
    if ((exam._count?.results ?? 0) > 0) return false;
    return true;
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

  const itemsForTab = useMemo(() => {
    if (classTab === 'all') return items;
    return items.filter((exam) => examClassId(exam) === classTab);
  }, [items, classTab]);

  const activeClassMeta = classTab !== 'all' ? sortedClasses.find((c) => c.id === classTab) : undefined;

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return itemsForTab;

    return itemsForTab.filter((exam) => {
      const batch = exam.aiTestConfig?.batch;
      const batchText = [batch?.name, batch?.academicClass?.name].filter(Boolean).join(' ');
      const haystack = [exam.title, exam.code, batchText].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [itemsForTab, searchTerm]);

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
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <HorizontalTabScroller className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setClassTab('all')}
              className="shrink-0"
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
          <div className="relative w-full max-w-sm sm:w-auto sm:flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search class tests..."
              className="pl-9"
            />
          </div>
        </div>

        <ScrollableListPanel maxHeightClass="max-h-[min(70vh,720px)]" className="space-y-4">
        {filteredItems.map((exam) => {
          const qCount = questionCount(exam);
          const cCount = exam._count?.registrations ?? 0;
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
                    <p className="mt-1 text-sm text-muted-foreground">{exam.code}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><HelpCircle className="h-3 w-3" />{qCount} question{qCount === 1 ? '' : 's'}</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{cCount} student{cCount === 1 ? '' : 's'}</span>
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
                  {exam.status === 'DRAFT' && (
                    <>
                      {can(Permission.EXAM_ASSIGN_CANDIDATES) && batch && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCandidatesDialog({ examId: exam.id, title: exam.title })}
                      >
                        Students ({cCount})
                      </Button>
                      )}
                      {can(Permission.EXAM_PUBLISH) && (
                      <Button
                        size="sm"
                        onClick={() => publishMutation.mutate(exam.id)}
                        disabled={!readyToPublish || publishMutation.isPending}
                      >
                        Publish
                      </Button>
                      )}
                    </>
                  )}
                  {can(Permission.EXAM_DELETE) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={!canDeleteExam(exam)}
                      title={
                        !canDeleteExam(exam)
                          ? 'Cannot delete: exam is completed or students have taken it'
                          : 'Permanently delete this exam'
                      }
                      onClick={() => setDeleteTarget({ id: exam.id, title: exam.title, code: exam.code })}
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
                    ? activeClassMeta
                      ? `No class tests for ${activeClassMeta.name}`
                      : 'No class tests in this class'
                    : 'No matching class tests'
              }
              description={
                !items.length
                  ? 'Create a NCERT-aligned test from uploaded books — it will appear here for scheduling and publishing to your batch.'
                  : itemsForTab.length === 0
                    ? 'Create a class test for this grade, or switch to All classes to see every test.'
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
                  <Button variant="outline" onClick={() => setClassTab('all')}>
                    View all classes
                  </Button>
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
            <div className="grid grid-cols-2 gap-3">
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
                <Label>Max attempts</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={scheduleForm.maxAttempts}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      maxAttempts: Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)),
                    }))
                  }
                />
              </div>
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
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={scheduleForm.timezone}
                onChange={(e) => {
                  const nextTimezone = e.target.value;
                  setScheduleAlert(null);
                  setScheduleForm((prev) => {
                    if (!prev.startTime) return { ...prev, timezone: nextTimezone };

                    const startUtc = localDateTimeToUtcIso(prev.startTime, prev.timezone);
                    const endUtc = prev.endTime ? localDateTimeToUtcIso(prev.endTime, prev.timezone) : null;

                    return {
                      ...prev,
                      timezone: nextTimezone,
                      startTime: utcIsoToLocalDateTimeInput(startUtc, nextTimezone),
                      endTime: endUtc ? utcIsoToLocalDateTimeInput(endUtc, nextTimezone) : prev.endTime,
                    };
                  });
                }}
              >
                {EXAM_TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
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
              Permanently delete <span className="font-medium text-foreground">{deleteTarget?.title}</span> ({deleteTarget?.code}).
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
