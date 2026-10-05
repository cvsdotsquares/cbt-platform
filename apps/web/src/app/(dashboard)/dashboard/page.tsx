'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, ArrowRight, CheckCircle2, BookOpen,
  GraduationCap, ClipboardList, Award, Calendar, TrendingUp,
  ExternalLink, Circle, ChevronRight, ChevronLeft, School, ShieldAlert, Eye, Trash2, RotateCcw,
} from 'lucide-react';
import { dashboardApi, onboardingApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  ViolationDetailDialog,
  type ViolationDetailResponse,
} from '@/components/proctoring/violation-detail-dialog';
import { ScrollableListPanel } from '@/components/layout/horizontal-tab-scroller';
import { useRequireAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissions } from '@/hooks/use-permissions';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { Permission } from '@cbt/shared';
import { StatCard } from '@/components/layout/stat-card';
import { WelcomeBannerGlassWaves } from '@/components/layout/welcome-banner-glass-waves';
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
  calendarExams?: {
    id: string;
    title: string;
    code: string;
    status?: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    _count?: { registrations: number };
  }[];
  previousExams?: {
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
    sessionId?: string;
    examId?: string;
    eventType: string;
    label: string;
    severity: string;
    candidateName: string;
    examTitle: string;
    occurredAt: string;
    message: string;
    detail?: ViolationDetailResponse;
  }[];
  clearedViolations?: {
    id: string;
    label: string;
    severity: string;
    candidateName: string;
    examTitle: string;
    occurredAt: string;
  }[];
};

type ScheduleMode = 'upcoming' | 'previous';

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
  if (roles.includes('ORG_ADMIN')) {
    return 'Your institute hub for classes, study material, AI-generated tests, and student results.';
  }
  return 'Run structured assessments for Classes 9–12 with AI-powered question generation from your books.';
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

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(key: string | null | undefined): key is string {
  return Boolean(key && DATE_KEY_RE.test(key));
}

/** Local calendar date at noon — avoids UTC drift and invalid keys. */
function parseDateKey(key: string) {
  if (!isValidDateKey(key)) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  }
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDateKeyLabel(key: string) {
  return parseDateKey(key).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Local calendar day as [start, nextDay) in UTC ISO for API filtering. */
function localDayBounds(key: string) {
  const d = parseDateKey(key);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

type ScheduledExam = NonNullable<DashboardData['upcomingExams']>[number];

function buildExamsByDate(exams: ScheduledExam[]) {
  const map = new Map<string, ScheduledExam[]>();
  exams.forEach((exam) => {
    if (!exam.startTime) return;
    const start = new Date(exam.startTime);
    if (Number.isNaN(start.getTime())) return;
    const key = dateKey(start);
    const list = map.get(key) ?? [];
    list.push(exam);
    map.set(key, list);
  });
  map.forEach((list) => {
    list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  });
  return map;
}

function monthGridCells(viewYear: number, viewMonth: number) {
  const first = new Date(viewYear, viewMonth, 1);
  const leading = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(viewYear, viewMonth, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function WeekStrip({
  exams,
  weekAnchor,
  filterDate,
  onSelectDate,
  onShiftWeek,
  onGoToToday,
}: {
  exams: ScheduledExam[];
  weekAnchor: string;
  filterDate: string | null;
  onSelectDate: (date: string) => void;
  onShiftWeek: (deltaDays: number) => void;
  onGoToToday: () => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => parseDateKey(weekAnchor));

  useEffect(() => {
    if (calendarOpen) {
      setViewMonth(parseDateKey(weekAnchor));
    }
  }, [calendarOpen, weekAnchor]);

  const today = new Date();
  const todayKey = dateKey(today);
  const anchor = parseDateKey(weekAnchor);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0, 0);
    return d;
  });
  const monthLabel = anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const examsByDate = useMemo(() => buildExamsByDate(exams), [exams]);
  const insightKey = filterDate ?? weekAnchor;
  const selectedCount = examsByDate.get(insightKey)?.length ?? 0;
  const selectedDayExams = examsByDate.get(insightKey) ?? [];
  const calendarCells = monthGridCells(viewMonth.getFullYear(), viewMonth.getMonth());
  const calendarMonthLabel = viewMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border/50 bg-card/80 p-5 shadow-card backdrop-blur-md dark:border-white/10 dark:bg-white/[0.04]">
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative mb-4 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Week view</p>
          <h3 className="text-sm font-bold">{monthLabel}</h3>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => onShiftWeek(-7)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            aria-label="Open schedule calendar"
            title="Open schedule calendar"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Calendar className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => onShiftWeek(7)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="max-w-md gap-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-b border-border/50 px-5 py-4 text-left">
            <DialogTitle className="text-base">Test schedule</DialogTitle>
            <DialogDescription>Browse dates and see upcoming class tests.</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() =>
                  setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
                }
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-bold">{calendarMonthLabel}</span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() =>
                  setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
                }
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((label, i) => (
                <span
                  key={`cal-h-${label}-${i}`}
                  className="pb-1 text-[10px] font-semibold uppercase text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {calendarCells.map((d, i) => {
                if (!d) {
                  return <span key={`cal-empty-${i}`} className="h-9" aria-hidden />;
                }
                const key = dateKey(d);
                const count = examsByDate.get(key)?.length ?? 0;
                const isToday = d.toDateString() === today.toDateString();
                const isSelected = filterDate === key;
                return (
                  <button
                    key={`cal-${key}`}
                    type="button"
                    onClick={() => {
                      onSelectDate(key);
                      setCalendarOpen(false);
                    }}
                    aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${count ? `, ${count} test${count === 1 ? '' : 's'}` : ''}`}
                    aria-pressed={isSelected}
                    className="flex h-9 flex-col items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : isToday
                            ? 'bg-primary/15 text-primary'
                            : 'text-foreground hover:bg-muted',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 h-1 w-1 rounded-full',
                        count > 0 ? 'bg-emerald-500' : 'bg-transparent',
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/50 pt-4">
              <p className="text-xs font-semibold text-muted-foreground">
                {formatDateKeyLabel(insightKey)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs"
                onClick={() => {
                  onGoToToday();
                  setViewMonth(new Date());
                }}
              >
                Today
              </Button>
            </div>
            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {selectedDayExams.length > 0 ? (
                selectedDayExams.map((exam) => (
                  <Link
                    key={exam.id}
                    href={`/dashboard/exams?exam=${exam.id}`}
                    onClick={() => setCalendarOpen(false)}
                    className="block rounded-xl border border-transparent bg-muted/60 px-3 py-2.5 transition-all hover:border-primary/20 hover:bg-muted hover:shadow-sm"
                  >
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {formatExamDateTime(exam.startTime, exam.timezone)}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold">{exam.title}</p>
                  </Link>
                ))
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No tests on this day</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <p className="relative mb-3 text-xs text-muted-foreground">
        {filterDate
          ? `${selectedCount} test${selectedCount === 1 ? '' : 's'} on selected day`
          : selectedCount > 0
            ? `${selectedCount} test${selectedCount === 1 ? '' : 's'} this week`
            : 'Tap a day to filter the schedule'}
      </p>
      <div className="relative grid grid-cols-7 gap-1 text-center">
        {days.map((d) => {
          const isToday = dateKey(d) === todayKey;
          const key = dateKey(d);
          const dayExamCount = examsByDate.get(key)?.length ?? 0;
          const isSelected = filterDate === key;
          return (
            <button
              key={`week-${key}`}
              type="button"
              onClick={() => onSelectDate(key)}
              aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${dayExamCount ? `, ${dayExamCount} scheduled test${dayExamCount === 1 ? '' : 's'}` : ', no scheduled tests'}`}
              aria-pressed={isSelected}
              className={cn(
                'group flex flex-col items-center gap-1.5 rounded-xl py-1.5 outline-none transition-all duration-200',
                'focus-visible:ring-2 focus-visible:ring-primary',
                isSelected && 'bg-primary/10 ring-1 ring-primary/30',
                !isSelected && 'hover:bg-muted/60',
              )}
            >
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                {WEEKDAYS[d.getDay()]}
              </span>
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-transform duration-200 group-hover:scale-105',
                  isSelected ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25' : isToday ? 'bg-primary/15 text-primary ring-1 ring-primary/25' : 'text-foreground',
                )}
              >
                {d.getDate()}
              </span>
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-transform duration-200',
                  dayExamCount > 0 ? 'scale-100 bg-emerald-500 shadow-[0_0_6px_hsl(160_84%_39%_/_0.6)]' : 'scale-75 bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { accessToken } = useRequireAuth(true);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { can } = usePermissions();
  const [violationTab, setViolationTab] = useState<'active' | 'cleared'>('active');
  const roles = normalizeRoles(user?.roles);
  const teacherPortal = isTeacherOnly(roles);

  useEffect(() => {
    if (teacherPortal) router.replace('/dashboard/teacher');
  }, [teacherPortal, router]);
  const [weekAnchor, setWeekAnchor] = useState(() => dateKey(new Date()));
  const [dateFilter, setDateFilter] = useState<string | null>(() => dateKey(new Date()));
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('upcoming');
  const [violationEventId, setViolationEventId] = useState<string | null>(null);
  const [violationDetail, setViolationDetail] = useState<ViolationDetailResponse | null>(null);

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.stats(accessToken!) as Promise<DashboardData>,
    enabled: !!accessToken && !teacherPortal,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const selectedDayBounds = useMemo(() => {
    if (scheduleMode !== 'upcoming' || !dateFilter) return null;
    return localDayBounds(dateFilter);
  }, [scheduleMode, dateFilter]);

  const canReadResults = can(Permission.RESULT_READ);

  const { data: selectedDaySubmissions, isFetching: selectedDaySubmissionsLoading } = useQuery({
    queryKey: ['dashboard-submissions', selectedDayBounds?.from, selectedDayBounds?.to],
    queryFn: () =>
      dashboardApi.submissionsForDay(
        accessToken!,
        selectedDayBounds!.from,
        selectedDayBounds!.to,
      ) as Promise<NonNullable<DashboardData['recentSubmissions']>>,
    enabled: !!accessToken && !!selectedDayBounds && canReadResults,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const { data: setup } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => onboardingApi.setupStatus(accessToken!) as Promise<SetupStatus>,
    enabled: !!accessToken,
  });

  const stats = data?.stats;
  const setupComplete = (setup?.progress ?? 0) >= 100;
  const visibleActions = quickActions.filter((a) => can(a.permission));
  const scheduledExams = data?.upcomingExams ?? [];
  const calendarExams = data?.calendarExams ?? scheduledExams;
  const previousExams = data?.previousExams ?? [];
  const selectedDayExams = dateFilter
    ? calendarExams.filter((exam) => dateKey(new Date(exam.startTime)) === dateFilter)
    : calendarExams;
  const displayedSchedule = scheduleMode === 'upcoming'
    ? (dateFilter ? selectedDayExams : scheduledExams)
    : previousExams;
  const daySubmissionsList =
    scheduleMode === 'upcoming' && dateFilter && canReadResults
      ? (selectedDaySubmissions ?? [])
      : [];
  const daySubmissionCount =
    scheduleMode === 'upcoming' && dateFilter && canReadResults
      ? (selectedDaySubmissions?.length ?? (selectedDaySubmissionsLoading ? null : 0))
      : null;
  const scheduleDayInsight =
    scheduleMode === 'upcoming' && dateFilter
      ? [
          `${selectedDayExams.length} test${selectedDayExams.length === 1 ? '' : 's'} scheduled`,
          canReadResults
            ? `${
                daySubmissionCount === null ? '…' : daySubmissionCount
              } submission${daySubmissionCount === 1 ? '' : 's'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
  const selectedDateLabel = dateFilter ? formatDateKeyLabel(dateFilter) : 'All upcoming';

  const shiftWeekAnchor = (deltaDays: number) => {
    const base = parseDateKey(weekAnchor);
    base.setDate(base.getDate() + deltaDays);
    setWeekAnchor(dateKey(base));
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  if (teacherPortal) return null;

  return (
    <div className="space-y-6">
      {setupComplete && user && (
        <section className="relative overflow-hidden rounded-[24px] border border-border/40 bg-gradient-to-br from-card via-card to-primary/5 shadow-card dark:border-white/10 dark:from-white/[0.06] dark:to-primary/10">
          <div className="pointer-events-none absolute -right-16 top-0 z-0 h-40 w-40 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 left-1/4 z-0 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
          <WelcomeBannerGlassWaves />
          <div className="relative z-10 p-6 sm:p-8">
            <p className="text-sm font-medium text-muted-foreground">{greeting}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {user.firstName} {user.lastName}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">{roleSubtitle(roles)}</p>
          </div>
        </section>
      )}

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
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button size="sm" className="w-full rounded-xl gradient-primary text-white hover:opacity-90" asChild>
                      <Link href={setup.nextStep.href}>
                        Continue setup <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" className="w-full rounded-xl" asChild>
                      <Link href="/dashboard/setup">Full onboarding</Link>
                    </Button>
                  </div>
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

          {scheduleDayInsight && (
            <div className="rounded-[18px] border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-semibold text-primary">Calendar insight · {selectedDateLabel}</p>
              <p className="mt-0.5 text-muted-foreground">{scheduleDayInsight}</p>
            </div>
          )}

          {canReadResults && (daySubmissionsList.length > 0 || (!dateFilter && (data?.recentSubmissions?.length ?? 0) > 0)) && (
            <Card className="overflow-hidden border-border/50 shadow-card transition-shadow hover:shadow-card-hover">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  {dateFilter && scheduleMode === 'upcoming' ? 'Submissions on selected day' : 'Recent submissions'}
                  {dateFilter && scheduleMode === 'upcoming' && selectedDaySubmissionsLoading && (
                    <span className="text-xs font-normal text-muted-foreground">Updating…</span>
                  )}
                </CardTitle>
              </CardHeader>
              <ScrollableListPanel maxHeightClass="max-h-72" className="divide-y divide-border/40">
                {(dateFilter && scheduleMode === 'upcoming' ? daySubmissionsList : data!.recentSubmissions!).map((sub) => {
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
              </ScrollableListPanel>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <WeekStrip
            exams={calendarExams}
            weekAnchor={weekAnchor}
            filterDate={dateFilter}
            onSelectDate={(key) => {
              setScheduleMode('upcoming');
              setDateFilter(key);
              setWeekAnchor(key);
            }}
            onShiftWeek={shiftWeekAnchor}
            onGoToToday={() => {
              setScheduleMode('upcoming');
              const today = dateKey(new Date());
              setDateFilter(today);
              setWeekAnchor(today);
            }}
          />

          {can(Permission.EXAM_READ) && (
            <div className="overflow-hidden rounded-[22px] border border-border/50 bg-card/80 p-4 shadow-card backdrop-blur-md dark:border-white/10 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">Schedule</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {scheduleMode === 'previous'
                      ? `${previousExams.length} previous test${previousExams.length === 1 ? '' : 's'}`
                      : dateFilter
                      ? `${selectedDayExams.length} test${selectedDayExams.length === 1 ? '' : 's'} on this day`
                      : `${scheduledExams.length} upcoming test${scheduledExams.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {scheduleMode === 'upcoming' && dateFilter && (
                    <button
                      type="button"
                      onClick={() => setDateFilter(null)}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Show all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScheduleMode(scheduleMode === 'upcoming' ? 'previous' : 'upcoming')}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    {scheduleMode === 'upcoming' ? 'Previous' : 'Upcoming'}
                  </button>
                </div>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                {scheduleMode === 'previous'
                  ? 'Recently completed tests'
                  : dateFilter ? selectedDateLabel : 'All upcoming tests'}
              </p>
              <div className="space-y-2">
                {displayedSchedule.length > 0 ? (
                  displayedSchedule.slice(0, 4).map((exam, idx) => {
                    const start = new Date(exam.startTime);
                    const end = exam.endTime ? new Date(exam.endTime) : null;
                    const timeLabel = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                      end ? `-${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
                    }`;
                    const active = idx === 0;
                    return (
                      <Link
                        key={exam.id}
                        href={`/dashboard/exams?exam=${exam.id}`}
                        className={cn(
                          'group block rounded-2xl px-4 py-3 transition-all duration-200',
                          active
                            ? 'bg-gradient-to-r from-primary to-violet-600 text-primary-foreground shadow-md shadow-primary/20'
                            : 'border border-transparent bg-muted/60 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-muted hover:shadow-sm',
                        )}
                      >
                        <p className={cn('text-[11px] font-semibold', active ? 'text-white/80' : 'text-muted-foreground')}>
                          {timeLabel}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold group-hover:underline">{exam.title}</p>
                        {!active && (
                          <p className="mt-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                            Open test details →
                          </p>
                        )}
                      </Link>
                    );
                  })
                ) : (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">No upcoming tests</p>
                )}
              </div>
            </div>
          )}

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
                  {violationTab === 'cleared' && (data?.clearedViolations?.length ?? 0) > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        if (!accessToken) return;
                        const ok = window.confirm(
                          'Permanently delete all alerts in the recycle bin? This cannot be undone.',
                        );
                        if (!ok) return;
                        try {
                          await dashboardApi.purgeRecycleBinViolations(accessToken);
                          await queryClient.refetchQueries({ queryKey: ['dashboard'] });
                          toast({ title: 'Recycle bin emptied', variant: 'success' });
                        } catch (e) {
                          toast({
                            title: 'Could not delete alerts',
                            description: e instanceof Error ? e.message : 'Try again',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      Clear all permanently
                    </Button>
                  ) : (stats?.violationAlerts ?? 0) > 0 && violationTab === 'active' ? (
                    <Badge variant="destructive" className="normal-case tracking-normal">
                      {stats!.violationAlerts} flagged
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-1 rounded-lg bg-muted/50 p-1">
                  <button
                    type="button"
                    onClick={() => setViolationTab('active')}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                      violationTab === 'active' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setViolationTab('cleared')}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                      violationTab === 'cleared' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Recycle bin
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {violationTab === 'active' && (data?.recentViolations?.length ?? 0) > 0 ? (
                  <div className="divide-y divide-border/40">
                    {data!.recentViolations!.slice(0, 5).map((v) => (
                      <div key={v.id} className="flex items-start gap-1 px-2 py-1">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          onClick={() => {
                            setViolationEventId(String(v.id));
                            setViolationDetail(v.detail ?? null);
                          }}
                        >
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
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="mt-2 shrink-0"
                          title="Move to recycle bin"
                          onClick={async () => {
                            if (!accessToken) return;
                            try {
                              await dashboardApi.dismissViolation(accessToken, String(v.id));
                              await queryClient.refetchQueries({ queryKey: ['dashboard'] });
                            } catch (e) {
                              toast({
                                title: 'Could not clear alert',
                                description: e instanceof Error ? e.message : 'Try again',
                                variant: 'destructive',
                              });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : violationTab === 'active' ? (
                  <div className="px-5 py-8 text-center">
                    <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
                    <p className="text-sm font-medium">No recent violations</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Proctoring flags will appear here.
                    </p>
                  </div>
                ) : (data?.clearedViolations?.length ?? 0) > 0 ? (
                  <div className="divide-y divide-border/40">
                    {data!.clearedViolations!.map((v) => (
                      <div key={v.id} className="flex items-start gap-1 px-2 py-1 opacity-80">
                        <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold uppercase text-muted-foreground">
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
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="mt-2 shrink-0"
                          title="Restore alert"
                          onClick={() => {
                            if (!accessToken) return;
                            dashboardApi.restoreViolation(accessToken, String(v.id)).then(() => {
                              queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                              queryClient.invalidateQueries({ queryKey: ['dashboard-submissions'] });
                            });
                          }}
                        >
                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <Trash2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
                    <p className="text-sm font-medium">Recycle bin is empty</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cleared integrity alerts appear here.
                    </p>
                  </div>
                )}
                {violationTab === 'active' && (data?.recentViolations?.length ?? 0) > 0 && (
                  <div className="border-t border-border/40 px-5 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground"
                      onClick={async () => {
                        if (!accessToken) return;
                        try {
                          await dashboardApi.dismissAllViolations(accessToken);
                          await queryClient.refetchQueries({ queryKey: ['dashboard'] });
                        } catch (e) {
                          toast({
                            title: 'Could not clear alerts',
                            description: e instanceof Error ? e.message : 'Try again',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      Clear all alerts
                    </Button>
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

      <ViolationDetailDialog
        eventId={violationEventId}
        prefetchedDetail={violationDetail}
        accessToken={accessToken}
        onOpenChange={(open) => {
          if (!open) {
            setViolationEventId(null);
            setViolationDetail(null);
          }
        }}
      />
    </div>
  );
}
