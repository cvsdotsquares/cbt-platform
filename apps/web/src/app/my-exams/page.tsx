'use client';

import { useMemo, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { examsApi, resultsApi, candidatesApi, authApi, learningApi } from '@/lib/api';
import { useRequireCandidate } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { isAdmin, normalizeRoles } from '@/lib/roles';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import { AdmitCardDialog, type AdmitCard } from '@/components/candidate/admit-card-dialog';
import { KycSubmitCard } from '@/components/candidate/kyc-submit-card';
import { CertificateDialog } from '@/components/candidate/certificate-dialog';
import { AnswerReviewDialog } from '@/components/results/answer-review-dialog';
import type { CertificateData } from '@/lib/certificate';
import { toast } from '@/hooks/use-toast';
import { getExamStatus, formatCountdown } from '@/lib/exam-status';
import { DEFAULT_EXAM_TIMEZONE } from '@cbt/shared';
import { formatExamTimeRange } from '@/lib/exam-dates';
import { formatRankLabel } from '@/lib/rank';
import { useNow } from '@/hooks/use-now';
import {
  LogOut, Play, Clock, Award, FileText, Shield, Download, IdCard,
  Search, CheckCircle2, AlertCircle, BookOpen, Wifi, Monitor, User, CircleHelp,
  Layers, Target, Eye,
} from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ExamRegistration = {
  id: string;
  examId: string;
  exam: {
    title: string; code: string; status: string;
    startTime: string; endTime: string; timezone?: string;
    settings?: { durationMinutes: number };
  };
  sessions?: { status: string }[];
};

type CandidateDashboard = {
  profile: {
    registrationNumber: string;
    kycStatus: string;
    email: string;
    fullName: string;
  };
  stats: {
    totalExams: number;
    submittedExams: number;
    inProgressExams: number;
    publishedResults: number;
    averageScore: number | null;
  };
};

type Tab = 'exams' | 'results' | 'progress';

const KYC_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_SUBMITTED: 'outline',
};

const READINESS_ITEMS = [
  { icon: Wifi, label: 'Stable internet connection' },
  { icon: BookOpen, label: 'Quiet place to focus on the test' },
  { icon: Monitor, label: 'Laptop or tablet with a modern browser' },
  { icon: User, label: 'Your institute login credentials' },
];

export default function MyExamsPage() {
  const router = useRouter();
  const { accessToken, ready } = useRequireCandidate();
  const { user, logout } = useAuthStore();
  const [admitCard, setAdmitCard] = useState<AdmitCard | null>(null);
  const [loadingAdmit, setLoadingAdmit] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<CertificateData | null>(null);
  const [loadingCertificate, setLoadingCertificate] = useState(false);
  const [reviewResultId, setReviewResultId] = useState<string | null>(null);
  const certificateRequestId = useRef(0);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('exams');
  const [syllabusSubjectId, setSyllabusSubjectId] = useState<string | 'ALL'>('ALL');
  const [syllabusChapterSearch, setSyllabusChapterSearch] = useState('');
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const now = useNow(15_000);

  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ['my-exams'],
    queryFn: () => examsApi.myExams(accessToken!),
    enabled: !!accessToken,
    refetchInterval: 60_000,
  });

  const { data: results } = useQuery({
    queryKey: ['my-results'],
    queryFn: () => resultsApi.my(accessToken!),
    enabled: !!accessToken,
  });

  const { data: dashboard } = useQuery({
    queryKey: ['candidate-dashboard'],
    queryFn: () => candidatesApi.dashboard(accessToken!) as Promise<CandidateDashboard>,
    enabled: !!accessToken,
  });

  const { data: learning, isLoading: learningLoading, isError: learningError } = useQuery({
    queryKey: ['student-learning'],
    queryFn: () => learningApi.studentDashboard(accessToken!) as Promise<{
      batches: { name: string; academicClass: { name: string } }[];
      stats: {
        averageScore: number | null;
        weakTopics: number;
        masteredTopics: number;
        doneChapters?: number;
        totalTests?: number;
      };
      weakAreas: { reason: string; topic: { title: string; chapter?: { title: string } } }[];
      topicMasteries: { accuracy: number; topic: { title: string }; subject?: { name: string } }[];
      syllabusCoverage?: {
        batch: { id: string; name: string; className: string };
        chapters: {
          id: string;
          number: number;
          title: string;
          status: string;
          subject: { id: string; name: string };
        }[];
        subjects?: {
          subject: { id: string; name: string };
          chapters: {
            id: string;
            number: number;
            title: string;
            status: string;
            subject: { id: string; name: string };
          }[];
        }[];
        stats: { total: number; done: number; studying: number; subjectCount?: number };
      }[];
    }>,
    enabled: !!accessToken,
  });

  const examList = ((exams as ExamRegistration[]) || []).filter((reg) => reg.exam);
  const resultList = (results as { items?: {
    id: string; totalScore: number; maxScore: number; percentage: number;
    rank?: number | null; percentile?: number | null; totalCandidates?: number | null;
    published: boolean; exam: { title: string; code: string; settings?: { passingScore?: number } };
  }[] })?.items || [];

  const filteredExams = examList.filter((reg) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return reg.exam.title.toLowerCase().includes(q) || reg.exam.code.toLowerCase().includes(q);
  });

  const syllabusBatches = useMemo(
    () => (learning?.syllabusCoverage ?? []).filter((c) => c.chapters.length > 0),
    [learning?.syllabusCoverage],
  );

  const syllabusSubjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const coverage of syllabusBatches) {
      const groups = coverage.subjects?.length
        ? coverage.subjects
        : [{ subject: { id: 'all', name: 'Chapters' }, chapters: coverage.chapters }];
      for (const group of groups) {
        const prev = map.get(group.subject.id);
        map.set(group.subject.id, {
          id: group.subject.id,
          name: group.subject.name,
          count: (prev?.count ?? 0) + group.chapters.length,
        });
      }
    }
    return Array.from(map.values());
  }, [syllabusBatches]);

  const stats = dashboard?.stats;
  const profile = dashboard?.profile;

  async function showAdmitCard(examId: string) {
    if (!accessToken) return;
    setLoadingAdmit(examId);
    try {
      const card = await candidatesApi.admitCard(accessToken, examId) as AdmitCard;
      setAdmitCard(card);
    } catch (e) {
      toast({
        title: 'Admit card unavailable',
        description: e instanceof Error ? e.message : 'Could not load admit card for this exam.',
        variant: 'destructive',
      });
    } finally {
      setLoadingAdmit(null);
    }
  }

  async function openCertificate(resultId: string) {
    if (!accessToken) return;
    const requestId = ++certificateRequestId.current;
    setLoadingCertificate(true);
    setCertificate(null);
    try {
      const cert = await resultsApi.certificate(accessToken, resultId) as CertificateData;
      if (certificateRequestId.current !== requestId) return;
      setCertificate(cert);
    } catch (e) {
      if (certificateRequestId.current !== requestId) return;
      toast({
        title: 'Certificate unavailable',
        description: e instanceof Error ? e.message : 'Results must be published before downloading a certificate.',
        variant: 'destructive',
      });
    } finally {
      if (certificateRequestId.current === requestId) {
        setLoadingCertificate(false);
      }
    }
  }

  function closeCertificate() {
    certificateRequestId.current += 1;
    setCertificate(null);
    setLoadingCertificate(false);
  }
  if (!ready) return null;
  if (user && isAdmin(normalizeRoles(user.roles))) return null;

  const greeting = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';

  return (
    <div className="min-h-screen mesh-bg">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="outline" size="sm" className="px-2 sm:px-3" onClick={() => router.push('/help')}>
              <CircleHelp className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Help</span>
            </Button>
            <ThemeToggle />
            <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 py-1.5 pl-1.5 pr-2 sm:pr-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary text-xs font-bold text-white">
                {initials}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold leading-none">{user?.firstName}</p>
                {profile && (
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{profile.registrationNumber}</p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="px-2 sm:px-3" onClick={async () => {
              const token = useAuthStore.getState().accessToken;
              if (token) await authApi.logout(token).catch(() => {});
              await logout();
              window.location.href = '/login';
            }}>
              <LogOut className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 animate-fade-in sm:space-y-8 sm:px-6 sm:py-10">
        <div className="hero-banner">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-primary">Good {greeting}, {user?.firstName}</p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">Student Portal</h1>
              {learning?.batches?.length ? (
                <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
                  <BookOpen className="h-3.5 w-3.5" />
                  {learning.batches.map((b) => `${b.academicClass.name} · ${b.name}`).join(' · ')}
                </p>
              ) : null}
              <p className="max-w-lg text-muted-foreground">
                Take NCERT-aligned class tests, review chapter-wise scores, and track your syllabus progress.
              </p>
            </div>
            {profile && (
              <Card className="surface-card shrink-0 border-primary/20 lg:w-72">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Profile</p>
                    <Badge variant={KYC_VARIANTS[profile.kycStatus] ?? 'outline'}>
                      KYC {profile.kycStatus.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="font-bold">{profile.fullName}</p>
                  <p className="text-sm text-muted-foreground">{profile.email}</p>
                  <p className="font-mono text-xs font-semibold text-primary">{profile.registrationNumber}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard title="Class Tests" value={stats?.totalExams ?? examList.length} icon={FileText} accent="blue" />
          <StatCard
            title="In Progress"
            value={stats?.inProgressExams ?? 0}
            icon={Clock}
            accent="amber"
            trend={stats?.inProgressExams ? 'Resume now' : undefined}
            trendUp={!!stats?.inProgressExams}
          />
          <StatCard title="Submitted" value={stats?.submittedExams ?? 0} icon={CheckCircle2} accent="green" />
          <StatCard
            title="Avg. Score"
            value={stats?.averageScore != null ? `${stats.averageScore.toFixed(1)}%` : '—'}
            icon={Award}
            accent="violet"
            trend={stats?.publishedResults ? `${stats.publishedResults} results` : undefined}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-xl border border-border/60 bg-muted/30 p-1">
                {(['exams', 'results', 'progress'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      'rounded-lg px-4 py-2 text-sm font-semibold capitalize transition-all',
                      tab === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'exams' ? `Class Tests (${examList.length})` : t === 'results' ? `Results (${resultList.length})` : 'Test syllabus'}
                  </button>
                ))}
              </div>
              {tab === 'exams' && (
                <div className="relative w-full sm:w-56">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search class tests..."
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
            </div>

            {tab === 'exams' && (
              <section className="space-y-3">
                {examsLoading ? <TableSkeleton rows={3} cols={1} /> : (
                  <>
                    {filteredExams.map((reg) => {
                      void now;
                      const status = getExamStatus(reg);
                      const tz = reg.exam.timezone || DEFAULT_EXAM_TIMEZONE;
                      const countdown = status.phase === 'upcoming'
                        ? formatCountdown(new Date(reg.exam.startTime).getTime())
                        : null;
                      return (
                        <Card
                          key={reg.id}
                          className={cn(
                            'surface-card group',
                            status.phase === 'available' && 'border-sky-500/35 ring-1 ring-sky-500/15',
                            status.phase === 'in_progress' && 'border-amber-500/30 ring-1 ring-amber-500/10',
                            status.phase === 'submitted' && 'border-emerald-500/25 ring-1 ring-emerald-500/10',
                          )}
                        >
                          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-4">
                              <div className={cn(
                                'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105',
                                status.phase === 'available' ? 'bg-sky-500/10 text-sky-600' :
                                status.phase === 'in_progress' ? 'bg-amber-500/10 text-amber-600' :
                                status.phase === 'submitted' ? 'bg-emerald-500/10 text-emerald-600' :
                                'bg-primary/10 text-primary',
                              )}>
                                <FileText className="h-6 w-6" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-bold">{reg.exam.title}</h3>
                                  <Badge variant={status.variant}>{status.label}</Badge>
                                  {countdown && (
                                    <Badge variant="outline" className="font-mono text-xs">
                                      Opens in {countdown}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">{reg.exam.code}</p>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    {reg.exam.settings?.durationMinutes ?? 30} min
                                  </span>
                                  <span>
                                    {formatExamTimeRange(reg.exam.startTime, reg.exam.endTime, tz)}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => showAdmitCard(reg.examId)}
                                disabled={loadingAdmit === reg.examId}
                              >
                                <IdCard className="mr-2 h-4 w-4" />
                                {loadingAdmit === reg.examId ? 'Loading...' : 'Admit Card'}
                              </Button>
                              <Button
                                onClick={() => router.push(`/exam/instructions/${reg.examId}`)}
                                disabled={status.actionDisabled}
                                variant={status.actionDisabled ? 'secondary' : 'default'}
                                className={status.phase === 'available' || status.phase === 'in_progress' ? 'gradient-primary border-0' : ''}
                              >
                                <Play className="mr-2 h-4 w-4" /> {status.actionLabel}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {!filteredExams.length && (
                      <Card className="surface-card">
                        <EmptyState
                          icon={search ? Search : FileText}
                          title={search ? 'No tests match your search' : 'No class tests assigned yet'}
                          description={search ? 'Try a different search term.' : 'Your teacher will assign NCERT class tests after publishing them for your batch.'}
                        />
                      </Card>
                    )}
                  </>
                )}
              </section>
            )}

            {tab === 'results' && (
              <section className="space-y-3">
                {resultList.map((r) => {
                  const pct = Math.min(100, r.percentage);
                  const passingScore = (r.exam.settings?.passingScore as number | undefined) ?? 40;
                  const passed = pct >= passingScore;
                  const rankLabel = formatRankLabel(r.rank, r.totalCandidates);
                  return (
                    <Card key={r.id} className="surface-card">
                      <CardContent className="p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              'flex h-12 w-12 items-center justify-center rounded-2xl',
                              passed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600',
                            )}>
                              <Award className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-bold">{r.exam.title}</p>
                              <p className="text-sm text-muted-foreground">{r.exam.code}</p>
                              {rankLabel && (
                                <p className="mt-1 text-xs font-semibold text-primary">{rankLabel}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-2xl font-bold tabular-nums text-primary">
                                {r.totalScore}<span className="text-base font-normal text-muted-foreground">/{r.maxScore}</span>
                              </p>
                              <p className="text-sm font-semibold text-muted-foreground">{r.percentage.toFixed(1)}%</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setReviewResultId(r.id)}>
                              <Eye className="mr-2 h-3.5 w-3.5" /> Answers
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openCertificate(r.id)} disabled={loadingCertificate}>
                              <Download className="mr-2 h-3.5 w-3.5" /> Certificate
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4 space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Score</span>
                            <span className={passed ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                              {passed ? 'Passed' : 'Below cutoff'}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn('h-full rounded-full transition-all', passed ? 'bg-emerald-500' : 'bg-red-500')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {!resultList.length && (
                  <Card className="surface-card">
                    <EmptyState
                      icon={Award}
                      title="No results published yet"
                      description="Your exam scores will appear here once results are published by the administrator."
                    />
                  </Card>
                )}
              </section>
            )}

            {tab === 'progress' && (
              <section className="space-y-5">
                {learningLoading ? (
                  <TableSkeleton rows={4} cols={1} />
                ) : learningError ? (
                  <Card className="surface-card border-destructive/30">
                    <CardContent className="p-5 text-sm text-destructive">
                      Could not load test syllabus. Please refresh and try again.
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.08] via-card to-card">
                      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                        <div className="flex gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-400">
                            <BookOpen className="h-5 w-5" />
                          </div>
                          <div className="space-y-1">
                            <h2 className="text-lg font-bold tracking-tight">What you can be tested on</h2>
                            <p className="max-w-xl text-sm text-muted-foreground">
                              Chapters your teacher marked Done. Class tests are built only from this list — revise these before your next exam.
                            </p>
                            {learning?.batches?.length ? (
                              <p className="pt-1 text-xs font-medium text-sky-800/80 dark:text-sky-300/80">
                                {learning.batches.map((b) => `${b.academicClass.name} · ${b.name}`).join(' · ')}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:min-w-[280px]">
                          {[
                            { label: 'Chapters', value: learning?.stats?.doneChapters ?? 0, icon: Layers },
                            { label: 'Mastered', value: learning?.stats?.masteredTopics ?? 0, icon: CheckCircle2 },
                            {
                              label: 'Avg score',
                              value: learning?.stats?.averageScore != null
                                ? `${learning.stats.averageScore.toFixed(0)}%`
                                : '—',
                              icon: Target,
                            },
                          ].map(({ label, value, icon: Icon }) => (
                            <div
                              key={label}
                              className="rounded-xl border border-border/50 bg-card/80 px-3 py-2.5 text-center shadow-sm backdrop-blur-sm"
                            >
                              <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                              <p className="text-base font-bold tabular-nums leading-none">{value}</p>
                              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {label}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {syllabusBatches.length > 0 ? (
                      <div className="space-y-4">
                        {(syllabusSubjects.length > 1 || syllabusBatches.some((b) => b.chapters.length > 4)) && (
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            {syllabusSubjects.length > 1 ? (
                              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <button
                                  type="button"
                                  onClick={() => setSyllabusSubjectId('ALL')}
                                  className={cn(
                                    'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                                    syllabusSubjectId === 'ALL'
                                      ? 'bg-foreground text-background'
                                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                                  )}
                                >
                                  All subjects
                                  <span className="ml-1.5 tabular-nums opacity-70">
                                    {learning?.stats?.doneChapters ?? 0}
                                  </span>
                                </button>
                                {syllabusSubjects.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setSyllabusSubjectId(s.id)}
                                    className={cn(
                                      'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                                      syllabusSubjectId === s.id
                                        ? 'bg-foreground text-background'
                                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                  >
                                    {s.name}
                                    <span className="ml-1.5 tabular-nums opacity-70">{s.count}</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Chapters in your test syllabus
                              </p>
                            )}
                            <div className="relative sm:w-56">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                value={syllabusChapterSearch}
                                onChange={(e) => setSyllabusChapterSearch(e.target.value)}
                                placeholder="Find a chapter…"
                                className="h-9 pl-9"
                              />
                            </div>
                          </div>
                        )}

                        {syllabusBatches.map((coverage) => {
                          const subjectGroups = (coverage.subjects?.length
                            ? coverage.subjects
                            : [{
                                subject: { id: 'all', name: 'Chapters' },
                                chapters: coverage.chapters,
                              }])
                            .map((group) => {
                              const q = syllabusChapterSearch.trim().toLowerCase();
                              const chapters = group.chapters.filter((ch) => {
                                if (syllabusSubjectId !== 'ALL' && group.subject.id !== syllabusSubjectId) {
                                  return false;
                                }
                                if (!q) return true;
                                return (
                                  ch.title.toLowerCase().includes(q)
                                  || String(ch.number).includes(q)
                                  || `ch ${ch.number}`.includes(q)
                                );
                              });
                              return { ...group, chapters };
                            })
                            .filter((g) => g.chapters.length > 0);

                          if (!subjectGroups.length) return null;

                          const visibleCount = subjectGroups.reduce((n, g) => n + g.chapters.length, 0);

                          return (
                            <Card key={coverage.batch.id} className="surface-card overflow-hidden">
                              <CardHeader className="border-b border-border/60 bg-card pb-3.5 pt-4 sm:px-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <CardTitle className="text-base font-semibold tracking-tight">
                                      {coverage.batch.className}
                                    </CardTitle>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      {coverage.batch.name}
                                      {coverage.stats.subjectCount
                                        ? ` · ${coverage.stats.subjectCount} subject${coverage.stats.subjectCount === 1 ? '' : 's'}`
                                        : ''}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="font-normal tabular-nums">
                                    {visibleCount} chapter{visibleCount === 1 ? '' : 's'}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="space-y-5 p-0 sm:p-0">
                                {subjectGroups.map((group, groupIndex) => (
                                  <div
                                    key={group.subject.id}
                                    className={cn(
                                      'border-border/60',
                                      groupIndex > 0 && 'border-t',
                                    )}
                                  >
                                    <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3 sm:px-5">
                                      <div className="flex min-w-0 items-center gap-2.5">
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
                                          <BookOpen className="h-3.5 w-3.5" />
                                        </span>
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-semibold tracking-tight">
                                            {group.subject.name}
                                          </p>
                                          <p className="text-[11px] text-muted-foreground">
                                            Included in class tests
                                          </p>
                                        </div>
                                      </div>
                                      <span className="shrink-0 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
                                        {group.chapters.length} ch
                                      </span>
                                    </div>

                                    <div className="relative">
                                      <ol
                                        className={cn(
                                          'divide-y divide-border/40',
                                          group.chapters.length > 5 && 'max-h-[17.5rem] overflow-y-auto overscroll-contain',
                                        )}
                                      >
                                        {group.chapters.map((ch, idx) => (
                                          <li
                                            key={ch.id}
                                            className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/25 sm:gap-4 sm:px-5"
                                          >
                                            <span className="w-5 shrink-0 text-center text-[11px] font-medium tabular-nums text-muted-foreground/70">
                                              {idx + 1}
                                            </span>
                                            <span className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background px-2 font-mono text-xs font-semibold tabular-nums text-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)]">
                                              Ch.{ch.number}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-medium leading-snug text-foreground">
                                                {ch.title}
                                              </p>
                                            </div>
                                            <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 sm:inline-flex">
                                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                              In syllabus
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                      {group.chapters.length > 5 && (
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
                                      )}
                                    </div>
                                    {group.chapters.length > 5 && (
                                      <p className="border-t border-border/40 px-4 py-2 text-center text-[11px] text-muted-foreground sm:px-5">
                                        Scroll to see all {group.chapters.length} chapters
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </CardContent>
                            </Card>
                          );
                        })}

                        {syllabusBatches.every((coverage) => {
                          const groups = coverage.subjects?.length
                            ? coverage.subjects
                            : [{ subject: { id: 'all', name: 'Chapters' }, chapters: coverage.chapters }];
                          return !groups.some((group) => {
                            if (syllabusSubjectId !== 'ALL' && group.subject.id !== syllabusSubjectId) return false;
                            const q = syllabusChapterSearch.trim().toLowerCase();
                            if (!q) return group.chapters.length > 0;
                            return group.chapters.some(
                              (ch) =>
                                ch.title.toLowerCase().includes(q)
                                || String(ch.number).includes(q),
                            );
                          });
                        }) && (
                          <Card className="surface-card">
                            <EmptyState
                              icon={Search}
                              title="No chapters match"
                              description="Try another subject filter or clear the search."
                            />
                          </Card>
                        )}
                      </div>
                    ) : (
                      <Card className="surface-card">
                        <EmptyState
                          icon={BookOpen}
                          title={
                            !(learning?.batches?.length)
                              ? 'Not enrolled in a batch'
                              : 'No test chapters yet'
                          }
                          description={
                            !(learning?.batches?.length)
                              ? 'Ask your admin to assign you to a class batch. You will then see chapters that class tests are based on.'
                              : 'Your teacher has not marked any chapters as Done yet. Class tests are created only from Done chapters.'
                          }
                        />
                      </Card>
                    )}

                    {learning?.weakAreas?.length ? (
                      <Card className="surface-card border-destructive/20">
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-base text-destructive">
                            <AlertCircle className="h-4 w-4" />
                            Revision recommended
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Topics from recent tests where you scored lower.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {learning.weakAreas.map((w, i) => (
                            <div key={i} className="rounded-xl border border-destructive/10 bg-destructive/[0.04] px-4 py-3 text-sm">
                              <p className="font-medium">{w.topic.title}</p>
                              {w.topic.chapter?.title ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">{w.topic.chapter.title}</p>
                              ) : null}
                              <p className="mt-1 text-muted-foreground">{w.reason}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}

                    {learning?.topicMasteries?.length ? (
                      <Card className="surface-card">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">Topic mastery</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            Based on your answers in published class tests.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {learning.topicMasteries.map((m, i) => (
                            <div key={i} className="space-y-1.5 rounded-xl border border-border/40 bg-muted/15 px-3.5 py-3">
                              <div className="flex justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate font-medium">
                                  {m.topic.title}
                                  {m.subject?.name ? (
                                    <span className="font-normal text-muted-foreground"> · {m.subject.name}</span>
                                  ) : null}
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 font-semibold tabular-nums',
                                    m.accuracy >= 70 ? 'text-emerald-600' : 'text-amber-600',
                                  )}
                                >
                                  {m.accuracy.toFixed(0)}%
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all',
                                    m.accuracy >= 70 ? 'bg-emerald-500' : 'bg-amber-500',
                                  )}
                                  style={{ width: `${m.accuracy}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}
                  </>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-4">
            {accessToken && profile && (
              <KycSubmitCard accessToken={accessToken} kycStatus={profile.kycStatus} />
            )}
            <Card className="surface-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  Exam Readiness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {READINESS_ITEMS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <span>{label}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="surface-card border-primary/20">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <BookOpen className="h-4 w-4 text-primary" />
                  NCERT Class Tests
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Class tests use only chapters marked Done for your batch. Check Test syllabus to revise what may appear in your next exam.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>

        <div className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          NCERT Institute · Classes 9–12
        </div>
      </main>

      <AdmitCardDialog card={admitCard} onClose={() => setAdmitCard(null)} />
      <AnswerReviewDialog
        open={!!reviewResultId}
        resultId={reviewResultId}
        accessToken={accessToken}
        onClose={() => setReviewResultId(null)}
      />
      <CertificateDialog
        certificate={certificate}
        loading={loadingCertificate && !certificate}
        onClose={closeCertificate}
      />
    </div>
  );
}
