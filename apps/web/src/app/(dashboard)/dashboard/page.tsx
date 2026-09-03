'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, Users, Sparkles, ArrowRight, CheckCircle2, BookOpen,
  GraduationCap, ClipboardList, Award, Calendar, TrendingUp,
  ExternalLink, Circle, ChevronRight, School, FileText, ShieldAlert, Eye,
} from 'lucide-react';
import { dashboardApi, onboardingApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissions } from '@/hooks/use-permissions';
import { normalizeRoles } from '@/lib/roles';
import { Permission } from '@cbt/shared';
import { StatCard } from '@/components/layout/stat-card';
import { formatExamDateTime } from '@/lib/exam-dates';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type SetupStep = {
  id: string;
  order: number;
  title: string;
  description: string;
  href: string;
  done: boolean;
  detail: string;
};

type SetupStatus = {
  progress: number;
  completed: number;
  total: number;
  nextStep?: SetupStep;
  steps: SetupStep[];
};

type DashboardData = {
  stats?: {
    totalExams: number;
    publishedExams: number;
    totalCandidates: number;
    totalQuestions: number;
    activeSessions: number;
    violationAlerts: number;
  };
  upcomingExams?: {
    id: string;
    title: string;
    code: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    _count?: { registrations: number };
  }[];
  recentSubmissions?: {
    id: string;
    candidateName: string;
    examTitle: string;
    percentage: number;
    submittedAt: string;
  }[];
  recentViolations?: {
    id: string;
    eventType: string;
    label: string;
    severity: string;
    candidateName: string;
    examTitle: string;
    occurredAt: string;
    message: string;
  }[];
};

type LessonTab = 'all' | 'in-progress' | 'planned' | 'completed';

type LessonCardItem = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  href: string;
  status: Exclude<LessonTab, 'all'>;
  meta: string;
  progressLabel?: string;
  icon: LucideIcon;
  accent: keyof typeof pastelAccents;
};

function severityTone(severity: string) {
  const s = severity?.toUpperCase();
  if (s === 'CRITICAL') return 'bg-red-500/15 text-red-700 dark:text-red-400';
  if (s === 'HIGH') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
  if (s === 'MEDIUM') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

const pastelAccents = {
  peach: 'bg-[#FFE8DC] text-[#D46A3A] dark:bg-orange-500/20 dark:text-orange-300',
  lavender: 'bg-[#EDE7FF] text-[#5B4BC4] dark:bg-[#7B8FF7]/20 dark:text-[#9aa8ff]',
  mint: 'bg-[#D8F3EA] text-[#2A8F6E] dark:bg-emerald-500/20 dark:text-emerald-300',
  yellow: 'bg-[#FFF3C4] text-[#B8860B] dark:bg-amber-500/20 dark:text-amber-300',
  sky: 'bg-[#DCEBFF] text-[#2F6FBF] dark:bg-sky-500/20 dark:text-sky-300',
  rose: 'bg-[#FFE0E8] text-[#C44A6A] dark:bg-rose-500/20 dark:text-rose-300',
};

const workflowSteps = [
  {
    num: 1,
    title: 'Upload NCERT books',
    desc: 'Add Class 9–12 PDFs — chapters and topics are extracted automatically',
    href: '/dashboard/materials',
    icon: Upload,
    permission: Permission.MATERIAL_READ,
    keys: ['materials', 'syllabus'] as const,
    accent: 'peach' as const,
    tags: ['Books', 'NCERT'],
  },
  {
    num: 2,
    title: 'Set up class & students',
    desc: 'Create batches, enroll students, mark completed chapters',
    href: '/dashboard/batches',
    icon: Users,
    permission: Permission.BATCH_READ,
    keys: ['batch', 'enroll', 'students', 'syllabus-progress'] as const,
    accent: 'lavender' as const,
    tags: ['Classes', 'Students'],
  },
  {
    num: 3,
    title: 'Create & publish class tests',
    desc: 'AI generates NCERT-aligned questions from studied chapters',
    href: '/dashboard/ai-tests',
    icon: Sparkles,
    permission: Permission.AI_GENERATE_TEST,
    keys: ['ai-test'] as const,
    accent: 'mint' as const,
    tags: ['AI', 'Tests'],
  },
];

const quickActions: {
  label: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  accent: keyof typeof pastelAccents;
}[] = [
  {
    label: 'Create Class Test',
    desc: 'NCERT AI test builder',
    href: '/dashboard/ai-tests',
    icon: Sparkles,
    permission: Permission.AI_GENERATE_TEST,
    accent: 'lavender',
  },
  {
    label: 'Classes & Batches',
    desc: 'Manage enrollments',
    href: '/dashboard/batches',
    icon: School,
    permission: Permission.BATCH_READ,
    accent: 'sky',
  },
  {
    label: 'NCERT Books',
    desc: 'Upload study material',
    href: '/dashboard/materials',
    icon: BookOpen,
    permission: Permission.MATERIAL_READ,
    accent: 'mint',
  },
  {
    label: 'Students',
    desc: 'Add or import learners',
    href: '/dashboard/candidates',
    icon: GraduationCap,
    permission: Permission.CANDIDATE_READ,
    accent: 'yellow',
  },
  {
    label: 'View Results',
    desc: 'Scores & rankings',
    href: '/dashboard/results',
    icon: Award,
    permission: Permission.RESULT_READ,
    accent: 'rose',
  },
  {
    label: 'Class Tests',
    desc: 'Publish & schedule',
    href: '/dashboard/exams',
    icon: ClipboardList,
    permission: Permission.EXAM_READ,
    accent: 'peach',
  },
];

function roleSubtitle(roles: string[]) {
  if (roles.includes('TEACHER')) {
    return 'Create NCERT-aligned tests, track class progress, and review student performance — all in one place.';
  }
  if (roles.includes('INSTITUTE_ADMIN') || roles.includes('ORG_ADMIN')) {
    return 'Your institute hub for classes, study material, AI-generated tests, and student results.';
  }
  return 'Run structured assessments for Classes 9–12 with AI-powered question generation from your books.';
}

function stepProgress(keys: readonly string[], doneMap: Map<string, boolean>) {
  const done = keys.filter((k) => doneMap.get(k)).length;
  return { done, total: keys.length, complete: done === keys.length };
}

function parseLeadingCount(detail?: string) {
  const m = detail?.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function WeekStrip() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const monthLabel = today.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="dash-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold">{monthLabel}</h3>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((d) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div key={d.toISOString()} className="flex flex-col items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                {WEEKDAYS[d.getDay()]}
              </span>
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                  isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                )}
              >
                {d.getDate()}
              </span>
              {isToday && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityChart({ submissions }: { submissions?: DashboardData['recentSubmissions'] }) {
  const bars = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    submissions?.forEach((s) => {
      counts[new Date(s.submittedAt).getDay()] += 1;
    });
    const max = Math.max(5, ...counts);
    const today = new Date().getDay();
    return WEEKDAYS.map((label, i) => ({
      label,
      value: counts[i],
      height: Math.max(12, (counts[i] / max) * 100),
      isToday: i === today,
    }));
  }, [submissions]);

  return (
    <div className="dash-card p-5">
      <h3 className="mb-4 text-sm font-bold">Lessons learnt</h3>
      <div className="flex h-28 items-end justify-between gap-1.5">
        {bars.map((bar, i) => (
          <div key={`${bar.label}-${i}`} className="flex flex-1 flex-col items-center gap-2">
            <div
              className={cn(
                'w-full max-w-[22px] rounded-t-lg transition-all',
                bar.isToday ? 'bg-primary' : 'bg-primary/15 dark:bg-primary/25',
              )}
              style={{ height: `${bar.height}%` }}
            />
            <span className={cn('text-[10px] font-semibold', bar.isToday ? 'text-primary' : 'text-muted-foreground')}>
              {bar.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { accessToken } = useRequireAuth(true);
  const { user } = useAuthStore();
  const { can } = usePermissions();
  const roles = normalizeRoles(user?.roles);
  const [tab, setTab] = useState<LessonTab>('all');

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.stats(accessToken!) as Promise<DashboardData>,
    enabled: !!accessToken,
  });

  const { data: setup } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => onboardingApi.setupStatus(accessToken!) as Promise<SetupStatus>,
    enabled: !!accessToken,
  });

  const stats = data?.stats;
  const doneMap = new Map((setup?.steps ?? []).map((s) => [s.id, s.done]));
  const setupComplete = (setup?.progress ?? 0) >= 100;
  const visibleActions = quickActions.filter((a) => can(a.permission));
  const visibleWorkflow = workflowSteps.filter((s) => can(s.permission));

  const lessons = useMemo<LessonCardItem[]>(() => {
    const items: LessonCardItem[] = [];

    visibleWorkflow.forEach((step) => {
      const progress = stepProgress(step.keys, doneMap);
      items.push({
        id: `workflow-${step.num}`,
        title: step.title,
        description: step.desc,
        tags: step.tags,
        href: step.href,
        status: progress.complete ? 'completed' : progress.done > 0 ? 'in-progress' : 'planned',
        meta: progress.complete ? 'Ready to use' : `${progress.done}/${progress.total} steps done`,
        progressLabel: progress.complete ? 'Complete' : progress.done > 0 ? `${progress.done} of ${progress.total} done` : 'Not started',
        icon: step.icon,
        accent: step.accent,
      });
    });

    (data?.upcomingExams ?? []).forEach((exam, idx) => {
      const accents: LessonCardItem['accent'][] = ['yellow', 'sky', 'rose', 'peach'];
      items.push({
        id: `exam-${exam.id}`,
        title: exam.title,
        description: exam.code,
        tags: ['Scheduled', exam.code],
        href: '/dashboard/exams',
        status: 'planned',
        meta: formatExamDateTime(exam.startTime, exam.timezone),
        progressLabel: exam._count ? `${exam._count.registrations} registered` : 'Upcoming',
        icon: FileText,
        accent: accents[idx % accents.length],
      });
    });

    return items;
  }, [visibleWorkflow, doneMap, data?.upcomingExams]);

  const filteredLessons = tab === 'all' ? lessons : lessons.filter((l) => l.status === tab);

  const tabs: { id: LessonTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'in-progress', label: 'In Progress' },
    { id: 'planned', label: 'Planned' },
    { id: 'completed', label: 'Completed' },
  ];

  return (
    <div className="space-y-6">
      {setup && !setupComplete && (
        <section className="hero-banner">
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl space-y-2">
              <Badge variant="warning" className="normal-case tracking-normal">
                Setup {setup.progress}% complete
              </Badge>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {roleSubtitle(roles)}
              </p>
            </div>
            <div className="dash-card w-full shrink-0 p-5 lg:max-w-sm">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-semibold">Getting started</span>
                <span className="tabular-nums text-muted-foreground">
                  {setup.completed}/{setup.total} steps
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-700 ease-out"
                  style={{ width: `${setup.progress}%` }}
                />
              </div>
              {setup.nextStep && (
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      Up next
                    </p>
                    <p className="mt-1 font-semibold">{setup.nextStep.title}</p>
                    <p className="text-sm text-muted-foreground">{setup.nextStep.detail}</p>
                  </div>
                  <Button size="sm" className="w-full rounded-xl gradient-primary text-white hover:opacity-90" asChild>
                    <Link href={setup.nextStep.href}>
                      Continue setup <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {can(Permission.CANDIDATE_READ) && (
              <StatCard title="Students" value={stats?.totalCandidates ?? 0} icon={GraduationCap} accent="green" />
            )}
            {can(Permission.EXAM_READ) && (
              <StatCard title="Published Tests" value={stats?.publishedExams ?? 0} icon={ClipboardList} accent="violet" />
            )}
            {can(Permission.PROCTORING_MONITOR) && (
              <StatCard
                title="Violation Alerts"
                value={stats?.violationAlerts ?? 0}
                icon={ShieldAlert}
                accent={(stats?.violationAlerts ?? 0) > 0 ? 'red' : 'amber'}
                trend={
                  (stats?.activeSessions ?? 0) > 0
                    ? `${stats!.activeSessions} live session(s)`
                    : (stats?.violationAlerts ?? 0) > 0
                      ? 'Needs review'
                      : 'All clear'
                }
              />
            )}
            {can(Permission.MATERIAL_READ) && (() => {
              const materialsDetail = setup?.steps.find((s) => s.id === 'materials')?.detail;
              const indexed = parseLeadingCount(materialsDetail);
              const totalMatch = materialsDetail?.match(/\/(\d+)/);
              const total = totalMatch ? Number(totalMatch[1]) : undefined;
              return (
                <StatCard
                  title="Indexed Books"
                  value={indexed}
                  icon={BookOpen}
                  accent="blue"
                  trend={total !== undefined && total > 0 ? `${total} uploaded` : undefined}
                />
              );
            })()}
            {!can(Permission.PROCTORING_MONITOR) && can(Permission.RESULT_READ) && (
              <StatCard
                title="AI Questions"
                value={stats?.totalQuestions ?? 0}
                icon={Sparkles}
                accent="amber"
                trend={stats?.publishedExams ? `${stats.publishedExams} live test(s)` : undefined}
                trendUp={!!stats?.publishedExams}
              />
            )}
          </div>

          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">My Lessons</h2>
                <p className="text-sm text-muted-foreground">Books, classes, and tests for your institute</p>
              </div>
              <div className="flex gap-1 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'relative shrink-0 px-3 py-1.5 text-sm font-semibold transition-colors',
                      tab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                    {tab === t.id && (
                      <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {filteredLessons.length === 0 && (
                <div className="rounded-[22px] border border-dashed border-border/70 bg-card/60 px-6 py-10 text-center">
                  <p className="text-sm font-medium">Nothing in this list yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Switch tabs or start a new class test.</p>
                </div>
              )}
              {filteredLessons.map((lesson) => {
                const Icon = lesson.icon;
                return (
                  <Link
                    key={lesson.id}
                    href={lesson.href}
                    className="dash-card group flex items-center gap-4 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 sm:p-5"
                  >
                    <div
                      className={cn(
                        'flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] sm:h-[72px] sm:w-[72px]',
                        pastelAccents[lesson.accent],
                      )}
                    >
                      <Icon className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold tracking-tight group-hover:text-primary">{lesson.title}</h3>
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{lesson.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {lesson.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-xs text-muted-foreground">{lesson.meta}</p>
                      {lesson.progressLabel && (
                        <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {lesson.progressLabel}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </section>

          {visibleActions.length > 0 && (
            <section>
              <h2 className="mb-4 text-base font-bold tracking-tight">Quick actions</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="dash-card group flex items-center gap-4 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25"
                    >
                      <div
                        className={cn(
                          'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                          pastelAccents[action.accent],
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[14px] transition-colors group-hover:text-primary">
                          {action.label}
                        </p>
                        <p className="text-[12px] text-muted-foreground">{action.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {can(Permission.RESULT_READ) && (data?.recentSubmissions?.length ?? 0) > 0 && (
            <Card className="overflow-hidden border-border/50">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  Recent submissions
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/40 p-0">
                {data!.recentSubmissions!.slice(0, 5).map((sub) => {
                  const pct = Math.round(sub.percentage);
                  const color =
                    pct >= 75 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : pct >= 50 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400';
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/30"
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold',
                          color,
                        )}
                      >
                        {pct}%
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{sub.candidateName}</p>
                        <p className="truncate text-xs text-muted-foreground">{sub.examTitle}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(sub.submittedAt)}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <WeekStrip />

          {can(Permission.EXAM_READ) && (
            <div className="dash-card p-4">
              <h3 className="mb-3 text-sm font-bold">Schedule</h3>
              <div className="space-y-2">
                {(data?.upcomingExams?.length ?? 0) > 0 ? (
                  data!.upcomingExams!.slice(0, 4).map((exam, idx) => {
                    const start = new Date(exam.startTime);
                    const end = exam.endTime ? new Date(exam.endTime) : null;
                    const timeLabel = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                      end ? `-${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
                    }`;
                    const active = idx === 0;
                    return (
                      <Link
                        key={exam.id}
                        href="/dashboard/exams"
                        className={cn(
                          'block rounded-2xl px-4 py-3 transition-all',
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-muted/60 hover:bg-muted',
                        )}
                      >
                        <p className={cn('text-[11px] font-semibold', active ? 'text-white/80' : 'text-muted-foreground')}>
                          {timeLabel}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold">{exam.title}</p>
                      </Link>
                    );
                  })
                ) : (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">No upcoming tests</p>
                )}
              </div>
            </div>
          )}

          <ActivityChart submissions={data?.recentSubmissions} />

          {can(Permission.PROCTORING_MONITOR) && (
            <Card
              className={cn(
                'overflow-hidden border-border/50',
                (stats?.violationAlerts ?? 0) > 0 && 'border-red-500/25',
              )}
            >
              <CardHeader className="border-b border-border/50 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <ShieldAlert
                      className={cn(
                        'h-4 w-4',
                        (stats?.violationAlerts ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground',
                      )}
                    />
                    Integrity alerts
                  </CardTitle>
                  {(stats?.violationAlerts ?? 0) > 0 && (
                    <Badge variant="destructive" className="normal-case tracking-normal">
                      {stats!.violationAlerts} flagged
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.recentViolations?.length ?? 0) > 0 ? (
                  <div className="divide-y divide-border/40">
                    {data!.recentViolations!.slice(0, 5).map((v) => (
                      <div key={v.id} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/20">
                        <div
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase',
                            severityTone(v.severity),
                          )}
                        >
                          {v.severity?.[0] ?? '!'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{v.candidateName}</p>
                          <p className="truncate text-xs text-muted-foreground">{v.label}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.examTitle}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {timeAgo(v.occurredAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
                    <p className="text-sm font-medium">No recent violations</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Proctoring flags will appear here.
                    </p>
                  </div>
                )}
                <div className="border-t border-border/50 px-5 py-3">
                  <Button variant="outline" size="sm" className="w-full rounded-xl hover:border-primary/30 hover:bg-primary/5" asChild>
                    <Link href="/dashboard/monitoring">
                      <Eye className="mr-2 h-3.5 w-3.5" />
                      Open live monitoring
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden border-primary/15">
            <div className="h-[2px] bg-gradient-to-r from-primary to-violet-500" />
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <GraduationCap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Student portal</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Students sign in and take assigned tests from{' '}
                    <strong className="font-medium text-foreground">My Tests</strong>.
                    No setup needed on their side.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Share this link</p>
                <p className="mt-1 font-mono text-sm">/login → Student account</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                  asChild
                >
                  <Link href="/login" target="_blank">
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Open login page
                  </Link>
                </Button>
                {can(Permission.CANDIDATE_READ) && (
                  <Button variant="ghost" size="sm" className="rounded-xl" asChild>
                    <Link href="/dashboard/candidates">Manage students</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {setup && !setupComplete && (
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold tracking-tight">Full setup checklist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0">
                {setup.steps.slice(0, 6).map((step) => (
                  <Link
                    key={step.id}
                    href={step.href}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-all hover:bg-muted/50 hover:pl-3"
                  >
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )}
                    <span className={cn('flex-1 truncate', step.done && 'text-muted-foreground')}>
                      {step.title}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
