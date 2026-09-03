'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { examsApi, resultsApi, type ExamListItem, type SubjectiveResponseItem } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Download, ClipboardCheck, Award, Users, BarChart3, CheckCircle2,
  GraduationCap, ArrowLeft, Trophy, FileSpreadsheet, Sparkles, Eye,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { AnswerReviewDialog } from '@/components/results/answer-review-dialog';

function questionCount(exam: ExamListItem) {
  return (exam.sections || []).reduce((sum, s) => sum + (s._count?.questions ?? 0), 0);
}

export default function ResultsPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const queryClient = useQueryClient();
  const [selectedExam, setSelectedExam] = useState('');
  const [showGrading, setShowGrading] = useState(false);
  const [gradeTarget, setGradeTarget] = useState<SubjectiveResponseItem | null>(null);
  const [gradeMarks, setGradeMarks] = useState('');
  const [reviewResultId, setReviewResultId] = useState<string | null>(null);

  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

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

  const { data: subjective } = useQuery({
    queryKey: ['subjective', selectedExam],
    queryFn: () => resultsApi.subjective(accessToken!, selectedExam),
    enabled: !!accessToken && !!selectedExam && showGrading,
  });

  const resultItems = results?.items ?? [];
  const unpublishedCount = resultItems.filter((r) => !r.published).length;
  const publishedCount = resultItems.filter((r) => r.published).length;
  const pendingGrading = (subjective || []).filter((r) => r.marksAwarded == null).length;
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

  const gradeMutation = useMutation({
    mutationFn: ({ sessionId, questionId, marks }: { sessionId: string; questionId: string; marks: number }) =>
      resultsApi.grade(accessToken!, sessionId, questionId, marks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjective', selectedExam] });
      queryClient.invalidateQueries({ queryKey: ['results', selectedExam] });
      setGradeTarget(null);
      toast({ title: 'Response graded', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Grading failed', description: e.message, variant: 'destructive' }),
  });

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

  function formatAnswer(answer: unknown): string {
    if (!answer) return '—';
    if (typeof answer === 'object' && answer !== null && 'value' in answer) {
      return String((answer as { value: unknown }).value);
    }
    return String(answer);
  }

  function selectExam(id: string) {
    setSelectedExam(id);
    setShowGrading(false);
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
          <StatCard title="Class tests" value={classTests.length} icon={FileSpreadsheet} accent="blue" />
          <StatCard
            title="With submissions"
            value={classTests.filter((e) => (e._count?.results ?? 0) > 0 || (e._count?.sessions ?? 0) > 0).length}
            icon={Users}
            accent="green"
          />
          <StatCard
            title="Published"
            value={classTests.filter((e) => e.status === 'PUBLISHED' || e.status === 'COMPLETED').length}
            icon={CheckCircle2}
            accent="violet"
          />
        </div>

        {examsLoading ? (
          <TableSkeleton rows={4} cols={1} />
        ) : classTests.length === 0 ? (
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
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold tracking-tight">Select a class test</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a test to view student scores, calculate ranks, and publish results.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {classTests.map((exam) => {
                const batch = exam.aiTestConfig?.batch;
                const sessions = exam._count?.sessions ?? 0;
                const resultCount = exam._count?.results ?? 0;
                const hasData = resultCount > 0 || sessions > 0;

                return (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => selectExam(exam.id)}
                    className={cn(
                      'group text-left rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-all',
                      'hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                        <Award className="h-5 w-5" />
                      </div>
                      <Badge variant={exam.status === 'PUBLISHED' || exam.status === 'COMPLETED' ? 'success' : 'secondary'}>
                        {exam.status}
                      </Badge>
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
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Exam selected: detail view ──────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { setSelectedExam(''); setShowGrading(false); }}
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
          {can(Permission.RESULT_EVALUATE) && (
            <Button variant="outline" size="sm" onClick={() => setShowGrading(!showGrading)}>
              <ClipboardCheck className="mr-2 h-4 w-4" />
              {showGrading ? 'Score table' : `Manual grading${pendingGrading > 0 ? ` (${pendingGrading})` : ''}`}
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
          value={avgScore != null ? `${avgScore.toFixed(1)}%` : '—'}
          icon={BarChart3}
          accent="violet"
        />
        <StatCard
          title="Top score"
          value={topScore != null ? `${topScore.toFixed(1)}%` : '—'}
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

      {showGrading && can(Permission.RESULT_EVALUATE) && !isLoading && (
        <Card className="surface-card overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              Manual grading
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(subjective || []).length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={ClipboardCheck}
                  title="No subjective answers"
                  description="This class test has no pending written/coding responses to grade."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-3 font-semibold">Student</th>
                      <th className="px-5 py-3 font-semibold">Question</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Answer</th>
                      <th className="px-5 py-3 font-semibold">Marks</th>
                      <th className="px-5 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(subjective || []).map((r) => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                        <td className="px-5 py-3.5 font-medium">
                          {r.session.candidate.user.firstName} {r.session.candidate.user.lastName}
                        </td>
                        <td className="px-5 py-3.5">{r.question.title}</td>
                        <td className="px-5 py-3.5"><Badge variant="outline">{r.question.type}</Badge></td>
                        <td className="max-w-xs truncate px-5 py-3.5 text-xs text-muted-foreground">{formatAnswer(r.answer)}</td>
                        <td className="px-5 py-3.5">
                          {r.marksAwarded != null ? `${r.marksAwarded}/${r.question.versions[0]?.marks ?? '?'}` : (
                            <Badge variant="warning">Pending</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <Button size="sm" variant="outline" onClick={() => {
                            setGradeTarget(r);
                            setGradeMarks(r.marksAwarded != null ? String(r.marksAwarded) : '');
                          }}>
                            Grade
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!showGrading && !isLoading && !isError && (
        <Card className="surface-card overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" />
              Scoreboard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {resultItems.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Award}
                  title="No scores yet"
                  description="Results appear after students submit this class test. Check Class Tests to confirm it’s published and assigned."
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
                    {resultItems.map((r) => {
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
                              <span className="w-12 text-right tabular-nums font-semibold">{pct.toFixed(1)}%</span>
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
        markedAnswerLabel="marked"
      />

      <Dialog open={!!gradeTarget} onOpenChange={(open) => !open && setGradeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grade response</DialogTitle>
            <DialogDescription>
              {gradeTarget?.question.title} — max {gradeTarget?.question.versions[0]?.marks ?? 0} marks
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">
            {gradeTarget ? formatAnswer(gradeTarget.answer) : ''}
          </div>
          <div className="space-y-2">
            <Label>Marks awarded</Label>
            <Input type="number" min={0} step={0.5} value={gradeMarks} onChange={(e) => setGradeMarks(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGradeTarget(null)}>Cancel</Button>
            <Button
              disabled={gradeMutation.isPending || !gradeTarget}
              onClick={() => gradeTarget && gradeMutation.mutate({
                sessionId: gradeTarget.sessionId,
                questionId: gradeTarget.questionId,
                marks: parseFloat(gradeMarks) || 0,
              })}
            >
              Save grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
