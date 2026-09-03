'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { examsApi, type ExamListItem } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/data-table';
import { ExamAssignCandidatesDialog } from '@/components/admin/exam-assign-candidates-dialog';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_EXAM_TIMEZONE,
  DEFAULT_PAST_START_GRACE_MINUTES,
  localDateTimeToUtcIso,
  nowLocalDateTimeInput,
  parseExamDateTime,
  validateExamSchedule,
} from '@cbt/shared';
import { EXAM_TIMEZONE_OPTIONS, formatExamTimeRange, utcIsoToLocalDateTimeInput } from '@/lib/exam-dates';
import { FileText, Users, Clock, HelpCircle, GraduationCap } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';

type ExamItem = ExamListItem;

function questionCount(exam: ExamItem) {
  return (exam.sections || []).reduce((sum, s) => sum + (s._count?.questions ?? 0), 0);
}

function addMinutesToLocalDateTime(local: string, minutes: number): string {
  if (!local) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const d = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExamsPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [candidatesDialog, setCandidatesDialog] = useState<{ examId: string; title: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; code: string } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ExamItem | null>(null);
  const [scheduleAlert, setScheduleAlert] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    startTime: '',
    endTime: '',
    timezone: DEFAULT_EXAM_TIMEZONE,
    durationMinutes: 30,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

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
      });
    } catch {
      return { ok: false as const, message: 'Start and end times must be valid dates.' };
    }
  }, [scheduleForm]);

  const startInPast = useMemo(() => {
    if (!scheduleForm.startTime) return false;
    try {
      const start = parseExamDateTime(scheduleForm.startTime, scheduleForm.timezone);
      const graceMs = DEFAULT_PAST_START_GRACE_MINUTES * 60_000;
      return start.getTime() < Date.now() - graceMs;
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
    ? addMinutesToLocalDateTime(scheduleForm.startTime, 1)
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
    const tz = exam.timezone || DEFAULT_EXAM_TIMEZONE;
    const duration = typeof exam.settings?.durationMinutes === 'number' && exam.settings.durationMinutes > 0
      ? exam.settings.durationMinutes
      : 30;
    setScheduleAlert(null);
    setScheduleForm({
      startTime: utcIsoToLocalDateTimeInput(exam.startTime, tz),
      endTime: utcIsoToLocalDateTimeInput(exam.endTime, tz),
      timezone: tz,
      durationMinutes: duration,
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
        endTime: value ? addMinutesToLocalDateTime(value, duration) : prev.endTime,
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
        ? addMinutesToLocalDateTime(prev.startTime, duration)
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

  if (isLoading) return <TableSkeleton rows={3} cols={1} />;

  const items: ExamItem[] = (data?.items || []).filter((exam) => exam.aiTestConfig);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Class Tests"
        highlight="Tests"
        description="Publish and schedule NCERT-aligned tests for your batches. Tests are created from uploaded books via Create Class Test."
        badge="NCERT · Classes 9–12"
      />

      <div className="space-y-3">
        {items.map((exam) => {
          const qCount = questionCount(exam);
          const cCount = exam._count?.registrations ?? 0;
          const batch = exam.aiTestConfig?.batch;
          const readyToPublish = qCount > 0 && cCount > 0;

          return (
            <Card key={exam.id} className="surface-card group">
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
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{cCount} candidate{cCount === 1 ? '' : 's'}</span>
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
                  {exam.status === 'DRAFT' && (
                    <>
                      {can(Permission.EXAM_UPDATE) && (
                        <Button size="sm" variant="outline" onClick={() => openScheduleEdit(exam)}>
                          Edit Schedule
                        </Button>
                      )}
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
                          ? 'Cannot delete: exam is completed or candidates have taken it'
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
        {!items.length && (
          <Card className="surface-card">
            <EmptyState
              icon={FileText}
              title="No class tests yet"
              description="Create a NCERT-aligned test from uploaded books — it will appear here for scheduling and publishing to your batch."
            />
            <div className="flex justify-center pb-8">
              <Button asChild>
                <Link href="/dashboard/ai-tests">Create Class Test</Link>
              </Button>
            </div>
          </Card>
        )}
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
                  setScheduleAlert(null);
                  setScheduleForm({ ...scheduleForm, timezone: e.target.value });
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
            <Button variant="outline" onClick={() => setScheduleTarget(null)}>Cancel</Button>
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
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
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
