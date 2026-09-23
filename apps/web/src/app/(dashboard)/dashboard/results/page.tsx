'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { curriculumApi, examsApi, resultsApi, type ExamListItem } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { HorizontalTabScroller, ScrollableListPanel } from '@/components/layout/horizontal-tab-scroller';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Download, Award, Users, BarChart3, CheckCircle2,
  GraduationCap, ArrowLeft, Trophy, FileSpreadsheet, Sparkles, Eye, Search, Trash2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { AnswerReviewDialog } from '@/components/results/answer-review-dialog';

function questionCount(exam: ExamListItem) {
  return (exam.sections || []).reduce((sum, s) => sum + (s._count?.questions ?? 0), 0);
}

type ClassTab = 'all' | string;
type StatusTab = 'all' | 'published' | 'draft';

function examClassId(exam: ExamListItem): string | undefined {
  return exam.aiTestConfig?.batch?.academicClass?.id;
}

function isPublishedExamStatus(status: ExamListItem['status']) {
  return status === 'PUBLISHED' || status === 'COMPLETED';
}

export default function ResultsPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const queryClient = useQueryClient();
  const [selectedExam, setSelectedExam] = useState('');
  const [classTab, setClassTab] = useState<ClassTab>('all');
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [reviewResultId, setReviewResultId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; code: string } | null>(null);

  const { data: exams, isLoading: examsLoading } = useQuery({
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

  const classTests = useMemo(() => {
    const items = (exams?.items ?? []).filter((e) => e.aiTestConfig);
    return [...items].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [exams]);

  const selectedMeta = classTests.find((e) => e.id === selectedExam) ?? (exams?.items ?? []).find((e) => e.id === selectedExam);

  const { data: results, isLoading, isError, error } = useQuery({
    queryKey: ['results', selectedExam],
    queryFn: () => resultsApi.byExam(accessToken!, selectedExam),
    enabled: !!accessToken && !!selectedExam,
  });

  const resultItems = results?.items ?? [];

  const classTabCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const exam of classTests) {
      const id = examClassId(exam);
      if (id) byClass.set(id, (byClass.get(id) ?? 0) + 1);
    }
    return byClass;
  }, [classTests]);

  const classTestsForClass = useMemo(() => {
    if (classTab === 'all') return classTests;
    return classTests.filter((exam) => examClassId(exam) === classTab);
  }, [classTests, classTab]);

  const publishedTestCount = useMemo(
    () => classTestsForClass.filter((e) => isPublishedExamStatus(e.status)).length,
    [classTestsForClass],
  );
  const draftTestCount = useMemo(
    () => classTestsForClass.filter((e) => e.status === 'DRAFT').length,
    [classTestsForClass],
  );

  const classTestsForTab = useMemo(() => {
    if (statusTab === 'published') {
      return classTestsForClass.filter((e) => isPublishedExamStatus(e.status));
    }
    if (statusTab === 'draft') {
      return classTestsForClass.filter((e) => e.status === 'DRAFT');
    }
    return classTestsForClass;
  }, [classTestsForClass, statusTab]);

  const activeClassMeta = classTab !== 'all' ? sortedClasses.find((c) => c.id === classTab) : undefined;

  const filteredClassTests = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return classTestsForTab;

    return classTestsForTab.filter((exam) => {
      const batch = exam.aiTestConfig?.batch;
      const batchText = [batch?.academicClass?.name, batch?.name].filter(Boolean).join(' ');
      const haystack = [exam.title, exam.code, batchText].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [classTestsForTab, searchTerm]);

  const filteredResultItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return resultItems;

    return resultItems.filter((r) => {
      const candidateName = [r.candidate.user.firstName, r.candidate.user.lastName].filter(Boolean).join(' ').toLowerCase();
      return candidateName.includes(query);
    });
  }, [resultItems, searchTerm]);

  const unpublishedCount = resultItems.filter((r) => !r.published).length;
  const publishedCount = resultItems.filter((r) => r.published).length;
  const avgScore = resultItems.length
    ? resultItems.reduce((sum, r) => sum + r.percentage, 0) / resultItems.length
    : null;
  const topScore = resultItems.length
    ? Math.max(...resultItems.map((r) => r.percentage))
    : null;

  const rankMutation = useMutation({
    mutationFn: (examId: string) => resultsApi.rank(accessToken!, examId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['results', selectedExam] });
      toast({ title: 'Ranks updated', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Rank calculation failed', description: e.message, variant: 'destructive' }),
  });

  const publishMutation = useMutation({
    mutationFn: (examId: string) => resultsApi.publish(accessToken!, examId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['results', selectedExam] });
      toast({ title: 'Results published', description: 'Students can now see scores in the Student Portal.', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Publish failed', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => examsApi.remove(accessToken!, id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      queryClient.removeQueries({ queryKey: ['results', id] });
      if (selectedExam === id) setSelectedExam('');
      setDeleteTarget(null);
      toast({ title: 'Class test deleted', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Cannot delete exam', description: e.message, variant: 'destructive' }),
  });

  function canDeleteExam(exam: ExamListItem) {
    if (exam.status === 'COMPLETED') return false;
    if ((exam._count?.sessions ?? 0) > 0) return false;
    if ((exam._count?.results ?? 0) > 0) return false;
    return true;
  }

  async function exportCsv() {
    if (!accessToken || !selectedExam) return;
    try {
      const blob = await resultsApi.exportCsv(accessToken, selectedExam);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `results-${selectedMeta?.code || selectedExam}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Export downloaded', variant: 'success' });
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Error', variant: 'destructive' });
    }
  }

  function selectExam(id: string) {
    setSelectedExam(id);
  }

  // ─── No exam selected: pick a class test ─────────────────────────────────
  if (!selectedExam) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Results"
          description={
            teacherPortal
              ? 'Review scores for your class tests and publish results so students can see them.'
              : 'Review scores, ranks, and publish results for NCERT class tests.'
          }
          badge={teacherPortal ? 'Teacher · Your tests' : 'NCERT · Classes 9–12'}
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <StatCard title="Class tests" value={classTestsForTab.length} icon={FileSpreadsheet} accent="blue" />
          <StatCard
            title="With submissions"
            value={classTestsForTab.filter((e) => (e._count?.results ?? 0) > 0 || (e._count?.sessions ?? 0) > 0).length}
            icon={Users}
            accent="green"
          />
          <StatCard
            title="Published"
            value={classTestsForTab.filter((e) => isPublishedExamStatus(e.status)).length}
            icon={CheckCircle2}
            accent="violet"
          />
        </div>

        {examsLoading ? (
          <TableSkeleton rows={4} cols={1} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <HorizontalTabScroller className="min-w-0 flex-1 sm:pb-0">
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
                  {classTests.length > 0 && (
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      classTab === 'all' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                    )}>
                      {classTests.length}
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
              <div className="flex shrink-0 gap-2 pb-2 sm:pb-0">
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
            </div>

            {classTests.length === 0 ? (
              <Card className="surface-card">
                <EmptyState
                  icon={Award}
                  title="No class tests yet"
                  description="Create and publish a class test first. Once students submit, their scores will appear here."
                />
                <div className="flex justify-center gap-3 pb-8">
                  <Button asChild>
                    <Link href="/dashboard/ai-tests">
                      <Sparkles className="mr-2 h-4 w-4" /> Create Class Test
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/dashboard/exams">View Class Tests</Link>
                  </Button>
                </div>
              </Card>
            ) : classTestsForTab.length === 0 ? (
              <Card className="surface-card">
                <EmptyState
                  icon={GraduationCap}
                  title={
                    statusTab === 'published'
                      ? 'No published class tests'
                      : statusTab === 'draft'
                        ? 'No draft class tests'
                        : activeClassMeta
                          ? `No class tests for ${activeClassMeta.name}`
                          : 'No class tests in this class'
                  }
                  description={
                    statusTab === 'published'
                      ? 'Publish a class test from Class Tests, or switch to All classes to see every test.'
                      : statusTab === 'draft'
                        ? 'Drafts are tests still being set up. Create one from Create Class Test, or view all tests.'
                        : 'Create a class test for this grade, or switch to All classes to see every test.'
                  }
                />
                <div className="flex justify-center gap-3 pb-8">
                  <Button variant="outline" onClick={() => setClassTab('all')}>
                    View all classes
                  </Button>
                  <Button asChild>
                    <Link href="/dashboard/ai-tests">
                      <Sparkles className="mr-2 h-4 w-4" /> Create Class Test
                    </Link>
                  </Button>
                </div>
              </Card>
            ) : (
              <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-bold tracking-tight">Select a class test</h3>
                <p className="text-sm text-muted-foreground">
                  {statusTab === 'published'
                    ? activeClassMeta
                      ? `Published class tests for ${activeClassMeta.name} — view scores, ranks, and publish results.`
                      : 'Published class tests — view scores, ranks, and publish results to students.'
                    : statusTab === 'draft'
                      ? activeClassMeta
                        ? `Draft class tests for ${activeClassMeta.name} — finish setup and publish before students can take them.`
                        : 'Draft class tests — finish setup and publish before students can take them.'
                      : activeClassMeta
                        ? `Class tests for ${activeClassMeta.name} — view scores, ranks, and publish results.`
                        : 'Choose a test to view student scores, calculate ranks, and publish results.'}
                </p>
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search class tests..."
                  className="pl-9"
                />
              </div>
            </div>

            {filteredClassTests.length === 0 ? (
              <Card className="surface-card">
                <EmptyState
                  icon={Award}
                  title="No matching class tests"
                  description={
                    searchTerm
                      ? 'Try a different test name, code, or batch.'
                      : activeClassMeta
                        ? `No tests match your filters for ${activeClassMeta.name}.`
                        : 'Try a different test name, code, or batch.'
                  }
                />
              </Card>
            ) : (
              <ScrollableListPanel maxHeightClass="max-h-[min(65vh,640px)]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredClassTests.map((exam) => {
                  const batch = exam.aiTestConfig?.batch;
                  const sessions = exam._count?.sessions ?? 0;
                  const resultCount = exam._count?.results ?? 0;
                  const hasData = resultCount > 0 || sessions > 0;

                  return (
                    <div
                      key={exam.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectExam(exam.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectExam(exam.id);
                        }
                      }}
                      className={cn(
                        'group cursor-pointer text-left rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-all',
                        'hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                          <Award className="h-5 w-5" />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant={exam.status === 'PUBLISHED' || exam.status === 'COMPLETED' ? 'success' : 'secondary'}>
                            {exam.status}
                          </Badge>
                          {can(Permission.EXAM_DELETE) && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              disabled={!canDeleteExam(exam)}
                              title={
                                !canDeleteExam(exam)
                                  ? 'Cannot delete: exam is completed or students have taken it'
                                  : 'Delete class test'
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget({ id: exam.id, title: exam.title, code: exam.code });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <h4 className="mt-4 font-bold leading-snug line-clamp-2">{exam.title}</h4>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">{exam.code}</p>

                      {batch && (
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          <GraduationCap className="h-3 w-3" />
                          {batch.academicClass.name} · {batch.name}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {exam._count?.registrations ?? 0} students
                        </span>
                        <span className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          {resultCount > 0 ? `${resultCount} results` : hasData ? `${sessions} sessions` : 'No scores yet'}
                        </span>
                        <span>{questionCount(exam)} Qs</span>
                      </div>

                      <p className="mt-4 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        Open results →
                      </p>
                    </div>
                  );
                })}
              </div>
              </ScrollableListPanel>
            )}
              </>
            )}
          </div>
        )}

        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete class test?</DialogTitle>
              <DialogDescription>
                Permanently delete <span className="font-medium text-foreground">{deleteTarget?.title}</span> ({deleteTarget?.code}).
                This removes all questions, results, and student assignments for this test.
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

  // ─── Exam selected: detail view ──────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedExam('')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to all tests
        </button>

        <PageHeader
          title={selectedMeta?.title ?? 'Results'}
          highlight={selectedMeta?.title?.split(/\s+/).slice(-2).join(' ')}
          description={
            selectedMeta?.aiTestConfig?.batch
              ? `${selectedMeta.code} · ${selectedMeta.aiTestConfig.batch.academicClass.name} · ${selectedMeta.aiTestConfig.batch.name}`
              : selectedMeta?.code ?? 'Class test results'
          }
          badge="Results"
        >
          {can(Permission.RESULT_RANK) && (
            <Button variant="outline" size="sm" disabled={rankMutation.isPending || resultItems.length === 0} onClick={() => rankMutation.mutate(selectedExam)}>
              <Trophy className="mr-2 h-4 w-4" />
              {rankMutation.isPending ? 'Calculating…' : 'Calculate ranks'}
            </Button>
          )}
          {can(Permission.RESULT_READ) && (
            <Button variant="outline" size="sm" disabled={!resultItems.length} onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          )}
          {can(Permission.RESULT_PUBLISH) && (
            <Button size="sm" disabled={publishMutation.isPending || resultItems.length === 0} onClick={() => publishMutation.mutate(selectedExam)}>
              {publishMutation.isPending ? 'Publishing…' : 'Publish to students'}
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard title="Students scored" value={resultItems.length} icon={Users} accent="blue" />
        <StatCard
          title="Average %"
          value={avgScore != null ? `${Number.isInteger(avgScore) ? avgScore : avgScore.toFixed(1)}%` : '—'}
          icon={BarChart3}
          accent="violet"
        />
        <StatCard
          title="Top score"
          value={topScore != null ? `${Number.isInteger(topScore) ? topScore : topScore.toFixed(1)}` : '—'}
          icon={Trophy}
          accent="amber"
        />
        <StatCard
          title="Published"
          value={publishedCount}
          icon={CheckCircle2}
          accent="green"
          trend={unpublishedCount > 0 ? `${unpublishedCount} draft` : undefined}
        />
      </div>

      {unpublishedCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <p>
              <strong>{unpublishedCount}</strong> result{unpublishedCount === 1 ? '' : 's'} still in draft.
              Students will only see scores after you publish.
            </p>
            {can(Permission.RESULT_PUBLISH) && (
              <Button size="sm" onClick={() => publishMutation.mutate(selectedExam)} disabled={publishMutation.isPending}>
                Publish now
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && <TableSkeleton rows={5} cols={5} />}

      {isError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Failed to load results: {error instanceof Error ? error.message : 'Unknown error'}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <Card className="surface-card overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" />
              Scoreboard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b border-border/60 p-4">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search student name..."
                  className="pl-9"
                />
              </div>
            </div>
            {filteredResultItems.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Award}
                  title={searchTerm ? 'No matching results' : 'No scores yet'}
                  description={
                    searchTerm
                      ? 'Try a different student name.'
                      : 'Results appear after students submit this class test. Check Class Tests to confirm it’s published and assigned.'
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Student</th>
                      <th className="px-5 py-3 font-semibold">Score</th>
                      <th className="px-5 py-3 font-semibold">Percentage</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Answers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResultItems.map((r) => {
                      const pct = Math.min(100, r.percentage);
                      return (
                        <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                          <td className="px-5 py-3.5">
                            <span className={cn(
                              'inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold',
                              r.rank === 1 && 'bg-amber-500/15 text-amber-600',
                              r.rank === 2 && 'bg-slate-400/15 text-slate-600',
                              r.rank === 3 && 'bg-orange-500/15 text-orange-700',
                              (!r.rank || r.rank > 3) && 'bg-primary/10 text-primary',
                            )}>
                              {r.rank ?? '—'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-medium">
                            {r.candidate.user.firstName} {r.candidate.user.lastName}
                          </td>
                          <td className="px-5 py-3.5 tabular-nums">
                            {r.totalScore}<span className="text-muted-foreground">/{r.maxScore}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex min-w-[120px] items-center gap-3">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500',
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-12 text-right tabular-nums font-semibold">
                                {Number.isInteger(pct) ? pct : pct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge variant={r.published ? 'success' : 'secondary'}>
                              {r.published ? 'Published' : 'Draft'}
                            </Badge>
                          </td>
                          <td className="px-5 py-3.5">
                            <Button variant="outline" size="sm" onClick={() => setReviewResultId(r.id)}>
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              Review
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AnswerReviewDialog
        open={!!reviewResultId}
        resultId={reviewResultId}
        accessToken={accessToken}
        onClose={() => setReviewResultId(null)}
        showCandidateName
        manualGradingEnabled={can(Permission.RESULT_EVALUATE)}
        markedAnswerLabel="marked"
        onGraded={() => {
          if (selectedExam) {
            void queryClient.invalidateQueries({ queryKey: ['results', selectedExam] });
          }
        }}
      />

    </div>
  );
}
