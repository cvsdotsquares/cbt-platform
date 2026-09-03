'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/layout/stat-card';
import { TableSkeleton } from '@/components/ui/skeleton';
import { batchesApi, examsApi, learningApi, type ExamListItem } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { formatExamDateTime } from '@/lib/exam-dates';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, Award, BookOpen, Calendar, CheckCircle2, ChevronRight, ClipboardList,
  FileText, GraduationCap, School, Sparkles, TrendingUp, Users,
} from 'lucide-react';

type TeacherBatch = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
  _count: { enrollments: number };
  teacherAssignments?: { subject: { id: string; name: string } }[];
};

type RecentResult = {
  id: string;
  percentage: number;
  createdAt?: string;
  exam?: { id: string; title: string; code?: string };
  candidate?: { user?: { firstName: string; lastName: string } };
};

const quickActions: {
  label: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}[] = [
  {
    label: 'Create Class Test',
    desc: 'AI test from your subjects',
    href: '/dashboard/ai-tests',
    icon: Sparkles,
    accent: 'from-violet-500/15 to-purple-500/5 text-violet-600',
  },
  {
    label: 'Topic Progress',
    desc: 'Mark chapters studied',
    href: '/dashboard/batches',
    icon: School,
    accent: 'from-blue-500/15 to-indigo-500/5 text-blue-600',
  },
  {
    label: 'Syllabus',
    desc: 'Books & chapters',
    href: '/dashboard/syllabus',
    icon: BookOpen,
    accent: 'from-emerald-500/15 to-teal-500/5 text-emerald-600',
  },
  {
    label: 'My Students',
    desc: 'Learners in your classes',
    href: '/dashboard/candidates',
    icon: GraduationCap,
    accent: 'from-amber-500/15 to-orange-500/5 text-amber-600',
  },
  {
    label: 'View Results',
    desc: 'Scores & rankings',
    href: '/dashboard/results',
    icon: Award,
    accent: 'from-rose-500/15 to-pink-500/5 text-rose-600',
  },
  {
    label: 'Class Tests',
    desc: 'Publish & schedule',
    href: '/dashboard/exams',
    icon: ClipboardList,
    accent: 'from-cyan-500/15 to-sky-500/5 text-cyan-600',
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isClassTest(exam: ExamListItem) {
  return !!exam.aiTestConfig;
}

export default function TeacherPage() {
  const { accessToken } = useRequireAuth(true);
  const { user } = useAuthStore();
  const greeting = getGreeting();

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<TeacherBatch[]>,
    enabled: !!accessToken,
  });

  const { data: examsPage, isLoading: examsLoading } = useQuery({
    queryKey: ['exams', 'teacher-hub'],
    queryFn: () => examsApi.list(accessToken!, 1, '', 50),
    enabled: !!accessToken,
  });

  const { data: activityFeed, isLoading: activityLoading } = useQuery({
    queryKey: ['teacher-activity-feed', (batches ?? []).map((b) => b.id).join(',')],
    queryFn: async () => {
      const list = batches ?? [];
      if (!list.length) return [] as RecentResult[];
      const settled = await Promise.all(
        list.slice(0, 6).map((b) =>
          learningApi.teacherAnalytics(accessToken!, b.id).catch(() => null) as Promise<{
            recentResults?: RecentResult[];
          } | null>,
        ),
      );
      const merged: RecentResult[] = [];
      for (const res of settled) {
        if (res?.recentResults?.length) merged.push(...res.recentResults);
      }
      merged.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
      // de-dupe by id
      const seen = new Set<string>();
      return merged.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }).slice(0, 8);
    },
    enabled: !!accessToken && !!batches?.length,
  });

  const classTests = useMemo(
    () => (examsPage?.items ?? []).filter(isClassTest),
    [examsPage],
  );

  const overview = useMemo(() => {
    const now = Date.now();
    const students = (batches ?? []).reduce((sum, b) => sum + (b._count?.enrollments ?? 0), 0);
    const published = classTests.filter((e) => e.status === 'PUBLISHED').length;
    const drafts = classTests.filter((e) => e.status === 'DRAFT').length;
    const subjects = new Set<string>();
    for (const b of batches ?? []) {
      for (const a of b.teacherAssignments ?? []) {
        if (a.subject?.name) subjects.add(a.subject.name);
      }
    }
    const upcoming = classTests
      .filter((e) => {
        const end = new Date(e.endTime).getTime();
        return ['PUBLISHED', 'SCHEDULED'].includes(e.status) && end >= now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5);
    const submissions = classTests.reduce((sum, e) => sum + (e._count?.results ?? 0), 0);
    return {
      classes: batches?.length ?? 0,
      students,
      published,
      drafts,
      subjects: subjects.size,
      submissions,
      upcoming,
    };
  }, [batches, classTests]);

  const isLoading = batchesLoading || examsLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="h-36 animate-pulse rounded-2xl bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <TableSkeleton rows={4} cols={2} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="hero-banner">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="normal-case tracking-normal">
                Teacher portal
              </Badge>
              {overview.classes > 0 ? (
                <Badge variant="success" className="normal-case tracking-normal">
                  <CheckCircle2 className="h-3 w-3" />
                  {overview.classes} class{overview.classes === 1 ? '' : 'es'} assigned
                </Badge>
              ) : (
                <Badge variant="warning" className="normal-case tracking-normal">
                  Waiting for class assignment
                </Badge>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-primary">
                Good {greeting}, {user?.firstName}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                Welcome to your{' '}
                <span className="gradient-text">teaching dashboard</span>
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                Create NCERT-aligned tests, track class progress, and review student performance — all in one place.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button size="sm" asChild>
              <Link href="/dashboard/ai-tests">
                <Sparkles className="mr-2 h-4 w-4" />
                Create Class Test
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/batches">
                <School className="mr-2 h-4 w-4" />
                Topic Progress
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard title="Students" value={overview.students} icon={Users} accent="green" />
        <StatCard title="Published Tests" value={overview.published} icon={ClipboardList} accent="violet" />
        <StatCard
          title="Classes"
          value={overview.classes}
          icon={School}
          accent="blue"
          trend={overview.subjects ? `${overview.subjects} subject(s)` : undefined}
        />
        <StatCard
          title="Submissions"
          value={overview.submissions}
          icon={TrendingUp}
          accent="amber"
          trend={overview.drafts ? `${overview.drafts} draft(s)` : undefined}
        />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Quick actions</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="group surface-card flex items-center gap-4 rounded-xl p-4"
              >
                <div className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br',
                  action.accent,
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium group-hover:text-primary">{action.label}</p>
                  <p className="text-sm text-muted-foreground">{action.desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card className="surface-card">
            <CardHeader className="border-b border-border/60 pb-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  Recent submissions
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/dashboard/results">
                    View all <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="divide-y divide-border/60 p-0">
              {activityLoading ? (
                <div className="p-5">
                  <TableSkeleton rows={4} cols={1} />
                </div>
              ) : (activityFeed?.length ?? 0) > 0 ? (
                activityFeed!.map((sub) => {
                  const name = sub.candidate?.user
                    ? `${sub.candidate.user.firstName} ${sub.candidate.user.lastName}`
                    : 'Student';
                  return (
                    <div key={sub.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-700">
                        {Math.round(sub.percentage)}%
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {sub.exam?.title ?? 'Class test'}
                        </p>
                      </div>
                      {sub.createdAt && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(sub.createdAt)}
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-medium">No submissions yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Results appear here after students submit your class tests.
                  </p>
                  <Button size="sm" className="mt-4" asChild>
                    <Link href="/dashboard/ai-tests">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Create a class test
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {overview.drafts > 0 && (
            <Card className="surface-card border-amber-500/25">
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-amber-800 dark:text-amber-300">
                    {overview.drafts} draft test{overview.drafts === 1 ? '' : 's'} waiting
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Review questions and publish when your class is ready.
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/exams">Open class tests</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6 lg:col-span-2">
          <Card className="surface-card">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Calendar className="h-4 w-4 text-primary" />
                Upcoming tests
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/60 p-0">
              {overview.upcoming.length > 0 ? (
                overview.upcoming.map((exam) => (
                  <Link
                    key={exam.id}
                    href="/dashboard/exams"
                    className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                      <FileText className="h-4 w-4 text-violet-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{exam.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatExamDateTime(exam.startTime, exam.timezone)}
                      </p>
                      {exam._count && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {exam._count.registrations} registered
                        </p>
                      )}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-medium">No upcoming tests</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Published or scheduled tests will show up here.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-card overflow-hidden border-primary/15">
            <div className="h-1 bg-gradient-to-r from-primary to-violet-500" />
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">Your teaching loop</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Mark topic progress → generate a class test → publish → review results.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link href="/dashboard/batches">Mark progress</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/syllabus">Open syllabus</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
