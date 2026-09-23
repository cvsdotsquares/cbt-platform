'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { batchesApi, curriculumApi, candidatesApi, usersApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import {
  School, Users, Plus, Search,
  GraduationCap, BookOpen, UserPlus, Trash2, Pencil, Upload, UserCog,
} from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

type Batch = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
  _count: { enrollments: number };
};

type BatchForm = { name: string; academicYear: string; academicClassId: string };

type SyllabusSubject = {
  subject: { id: string; name: string };
  chapters: {
    id: string;
    number: number;
    title: string;
    status: string;
    topics?: { id: string; title: string; status?: string }[];
  }[];
};

type TabId = 'students' | 'syllabus' | 'teachers';

type BatchTeacherAssignment = {
  id: string;
  userId: string;
  subjectId: string;
  subject: { id: string; name: string };
  user: { id: string; firstName: string; lastName: string; email: string } | null;
};

type StaffUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  userRoles: { role: { name: string } }[];
};

const STATUS_CONFIG = {
  COMPLETED: {
    label: 'Done',
    dot: 'bg-primary',
    active: 'bg-primary text-primary-foreground shadow-sm shadow-primary/25',
  },
  IN_PROGRESS: {
    label: 'Studying',
    dot: 'bg-violet-500',
    active: 'bg-violet-500 text-white shadow-sm shadow-violet-500/25',
  },
  NOT_STARTED: {
    label: 'Not started',
    dot: 'bg-muted-foreground/40',
    active: 'bg-secondary text-secondary-foreground shadow-sm ring-1 ring-border',
  },
};

function ProgressRing({ percent, className }: { percent: number; className?: string }) {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference - (clamped / 100) * circumference;
  const gradientId = 'batch-progress-ring';

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full bg-primary/5 ring-1 ring-primary/10',
        className,
      )}
      style={{ width: size, height: size }}
      title={`${clamped}% complete`}
    >
      <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="50%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums leading-none text-foreground">{clamped}%</span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Done</span>
      </div>
    </div>
  );
}

function calcProgress(subjects: SyllabusSubject[]) {
  const chapters = subjects.flatMap((s) => s.chapters);
  if (!chapters.length) return { percent: 0, studied: 0, total: 0, completed: 0 };
  const completed = chapters.filter((c) => c.status === 'COMPLETED').length;
  const studied = chapters.filter((c) => c.status === 'COMPLETED' || c.status === 'IN_PROGRESS').length;
  return {
    percent: Math.round((completed / chapters.length) * 100),
    studied,
    total: chapters.length,
    completed,
  };
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export default function BatchesPage() {
  const searchParams = useSearchParams();
  const batchFromQuery = searchParams.get('batch');
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const canManage = can(Permission.BATCH_MANAGE);
  const queryClient = useQueryClient();
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('syllabus');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<BatchForm>({ name: '', academicYear: '2025-26', academicClassId: '' });
  const [editForm, setEditForm] = useState<BatchForm>({ name: '', academicYear: '', academicClassId: '' });
  const [enrollCandidateId, setEnrollCandidateId] = useState('');
  const [enrollRoll, setEnrollRoll] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [assignTeacherUserId, setAssignTeacherUserId] = useState('');
  const [assignSubjectId, setAssignSubjectId] = useState('');

  const { data: batches, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<Batch[]>,
    enabled: !!accessToken,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{ id: string; level: number; name: string }[]>,
    enabled: !!accessToken,
  });

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['syllabus-progress', selectedBatch],
    queryFn: () => batchesApi.getSyllabusProgress(accessToken!, selectedBatch!) as Promise<SyllabusSubject[]>,
    enabled: !!accessToken && !!selectedBatch,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: batchDetail } = useQuery({
    queryKey: ['batch-detail', selectedBatch],
    queryFn: () => batchesApi.get(accessToken!, selectedBatch!) as Promise<{
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number; subjects?: { id: string; name: string }[] };
      enrollments: {
        id: string;
        rollNumber?: string;
        candidate: { id: string; registrationNumber: string; user: { firstName: string; lastName: string } };
      }[];
    }>,
    enabled: !!accessToken && !!selectedBatch,
  });

  const { data: candidatesData } = useQuery({
    queryKey: ['candidates-enroll'],
    queryFn: () => candidatesApi.list(accessToken!, 1, ''),
    enabled: !!accessToken && !!selectedBatch && activeTab === 'students',
  });

  const { data: batchTeachers, isLoading: teachersLoading } = useQuery({
    queryKey: ['batch-teachers', selectedBatch],
    queryFn: () => batchesApi.listTeachers(accessToken!, selectedBatch!) as Promise<BatchTeacherAssignment[]>,
    enabled: !!accessToken && !!selectedBatch && (activeTab === 'teachers' || canManage),
  });

  const { data: staffUsersData } = useQuery({
    queryKey: ['staff-teachers-for-batch'],
    queryFn: () => usersApi.list(accessToken!, 1, '', 100) as Promise<{ items: StaffUser[] }>,
    enabled: !!accessToken && canManage && activeTab === 'teachers',
  });

  const teacherOptions = useMemo(
    () => (staffUsersData?.items ?? []).filter((u) =>
      u.userRoles.some((ur) => ur.role.name === 'TEACHER'),
    ),
    [staffUsersData],
  );

  const batchSubjects = batchDetail?.academicClass.subjects ?? [];

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return batches ?? [];
    return (batches ?? []).filter(
      (b) =>
        b.name.toLowerCase().includes(q)
        || b.academicClass.name.toLowerCase().includes(q)
        || b.academicYear.includes(q),
    );
  }, [batches, search]);

  const selectedBatchMeta = (batches ?? []).find((b) => b.id === selectedBatch);
  const progressStats = useMemo(() => calcProgress(progress ?? []), [progress]);

  const activeSubject = useMemo(() => {
    const subjects = progress ?? [];
    if (!subjects.length) return null;
    return subjects.find((s) => s.subject.id === selectedSubjectId) ?? subjects[0];
  }, [progress, selectedSubjectId]);

  useEffect(() => {
    if (batchFromQuery && batches?.some((b) => b.id === batchFromQuery)) {
      setSelectedBatch(batchFromQuery);
      return;
    }
    if (!selectedBatch && batches?.length) {
      setSelectedBatch(batches[0].id);
    }
  }, [batches, selectedBatch, batchFromQuery]);

  useEffect(() => {
    if (!accessToken || !selectedBatch || !enrollCandidateId) return;
    let cancelled = false;
    batchesApi
      .nextRollNumber(accessToken, selectedBatch)
      .then(({ rollNumber }) => {
        if (!cancelled) setEnrollRoll((prev) => prev || rollNumber);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedBatch, enrollCandidateId]);

  useEffect(() => {
    if (progress?.length && !selectedSubjectId) {
      setSelectedSubjectId(progress[0].subject.id);
    }
  }, [progress, selectedSubjectId]);

  useEffect(() => {
    setSelectedSubjectId(null);
    setAssignTeacherUserId('');
    setAssignSubjectId('');
  }, [selectedBatch]);

  const totalStudents = useMemo(
    () => (batches ?? []).reduce((sum, b) => sum + b._count.enrollments, 0),
    [batches],
  );

  const classCount = useMemo(
    () => new Set((batches ?? []).map((b) => b.academicClass.level)).size,
    [batches],
  );

  const enrollMutation = useMutation({
    mutationFn: () => batchesApi.enroll(accessToken!, selectedBatch!, {
      candidateId: enrollCandidateId,
      rollNumber: enrollRoll || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-detail', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setEnrollCandidateId('');
      setEnrollRoll('');
      toast({ title: 'Student added to batch' });
    },
    onError: (e: Error) => toast({ title: 'Could not enroll', description: e.message, variant: 'destructive' }),
  });

  const assignTeacherMutation = useMutation({
    mutationFn: () =>
      batchesApi.assignTeacher(accessToken!, selectedBatch!, {
        userId: assignTeacherUserId,
        subjectId: assignSubjectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-teachers', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['teacher-assignments'] });
      setAssignTeacherUserId('');
      setAssignSubjectId('');
      toast({ title: 'Teacher assigned', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not assign teacher', description: e.message, variant: 'destructive' }),
  });

  const removeTeacherMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      batchesApi.removeTeacher(accessToken!, selectedBatch!, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-teachers', selectedBatch] });
      toast({ title: 'Teacher removed', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not remove teacher', description: e.message, variant: 'destructive' }),
  });

  const createMutation = useMutation({
    mutationFn: () => batchesApi.create(accessToken!, form),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setShowCreate(false);
      setForm({ name: '', academicYear: '2025-26', academicClassId: '' });
      const created = data as { id?: string };
      if (created?.id) setSelectedBatch(created.id);
      toast({ title: 'Batch created', description: 'Add students and mark studied chapters.' });
    },
    onError: (e: Error) => toast({ title: 'Could not create batch', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: () => batchesApi.update(accessToken!, selectedBatch!, editForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-detail', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setShowEdit(false);
      toast({ title: 'Batch updated' });
    },
    onError: (e: Error) => toast({ title: 'Could not update batch', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => batchesApi.remove(accessToken!, selectedBatch!),
    onSuccess: (data) => {
      const result = data as { name?: string; studentsUnassigned?: number };
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['batch-detail'] });
      setShowDelete(false);
      setSelectedBatch(null);
      toast({
        title: 'Batch deleted',
        description: result.studentsUnassigned
          ? `${result.studentsUnassigned} student(s) are now unassigned.`
          : undefined,
        variant: 'success',
      });
    },
    onError: (e: Error) => toast({ title: 'Could not delete batch', description: e.message, variant: 'destructive' }),
  });

  const updateProgress = useMutation({
    mutationFn: ({ chapterId, status }: { chapterId: string; status: string }) =>
      batchesApi.updateSyllabusProgress(accessToken!, selectedBatch!, { chapterId, status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] }),
  });

  const enrolledIds = new Set((batchDetail?.enrollments ?? []).map((e) => e.candidate.id));
  const availableCandidates = ((candidatesData?.items ?? []) as {
    id: string;
    registrationNumber: string;
    user: { firstName: string; lastName: string };
  }[]).filter((c) => !enrolledIds.has(c.id));

  function openEditDialog() {
    const meta = selectedBatchMeta;
    const detail = batchDetail;
    if (!meta) return;
    const classId = detail?.academicClass.id
      ?? classes?.find((c) => c.level === meta.academicClass.level)?.id
      ?? '';
    setEditForm({
      name: detail?.name ?? meta.name,
      academicYear: detail?.academicYear ?? meta.academicYear,
      academicClassId: classId,
    });
    setShowEdit(true);
  }

  const tabs = ([
    { id: 'syllabus' as const, label: 'Syllabus', icon: BookOpen, show: true },
    {
      id: 'students' as const,
      label: 'Students',
      count: batchDetail?.enrollments?.length ?? selectedBatchMeta?._count.enrollments ?? 0,
      icon: Users,
      show: true,
    },
    {
      id: 'teachers' as const,
      label: 'Teachers',
      count: batchTeachers?.length ?? 0,
      icon: UserCog,
      show: canManage,
    },
  ] as const).filter((t) => t.show);

  return (
    <div className="space-y-6">
      <PageHeader
        title={teacherPortal ? 'Topic Progress' : 'Classes & Batches'}
        highlight={teacherPortal ? 'Progress' : 'Batches'}
        badge={teacherPortal ? 'Teacher' : 'Admin'}
        description={
          teacherPortal
            ? 'Select a class and mark chapter progress for your subjects.'
            : 'Organize students into class batches and track which chapters they have studied.'
        }
      >
        {canManage && (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New batch
          </Button>
        )}
        {can(Permission.MATERIAL_READ) && !teacherPortal && (
          <Button variant="outline" asChild>
            <Link href="/dashboard/materials">
              <Upload className="mr-2 h-4 w-4" /> Books
            </Link>
          </Button>
        )}
        {can(Permission.CURRICULUM_READ) && !teacherPortal && (
          <Button variant="outline" asChild>
            <Link href="/dashboard/syllabus">
              <BookOpen className="mr-2 h-4 w-4" /> Syllabus
            </Link>
          </Button>
        )}
      </PageHeader>

      {!teacherPortal && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Batches" value={batches?.length ?? 0} icon={School} accent="blue" />
          <StatCard title="Students enrolled" value={totalStudents} icon={Users} accent="green" />
          <StatCard title="Classes" value={classCount} icon={GraduationCap} accent="violet" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Batch list */}
        <Card className="surface-card h-fit">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Batches</CardTitle>
              <span className="text-xs text-muted-foreground tabular-nums">{filteredBatches.length}</span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {isLoading ? (
              <TableSkeleton rows={4} />
            ) : filteredBatches.length === 0 ? (
              <div className="px-2 py-6">
                <EmptyState
                  icon={School}
                  title={search ? 'No matches' : 'No batches yet'}
                  description={search ? 'Try a different search.' : 'Create a batch to get started.'}
                />
                {canManage && !search && (
                  <div className="flex justify-center pb-2">
                    <Button size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Create batch
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              filteredBatches.map((batch) => {
                const isActive = selectedBatch === batch.id;
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setSelectedBatch(batch.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}>
                      {batch.academicClass.level}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{batch.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {batch.academicClass.name} · {batch._count.enrollments} students
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Batch detail */}
        <div className="min-w-0 space-y-4">
          {!selectedBatch ? (
            <Card className="surface-card">
              <EmptyState
                icon={BookOpen}
                title="Select a batch"
                description="Choose a batch from the list to view students and syllabus progress."
              />
            </Card>
          ) : (
            <>
              <Card className="surface-card">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-bold tracking-tight">
                        {batchDetail?.name ?? selectedBatchMeta?.name}
                      </h2>
                      <Badge variant="secondary" className="normal-case tracking-normal">
                        {batchDetail?.academicClass.name ?? selectedBatchMeta?.academicClass.name}
                      </Badge>
                      <Badge variant="outline" className="normal-case tracking-normal">
                        {batchDetail?.academicYear ?? selectedBatchMeta?.academicYear}
                      </Badge>
                    </div>
                    {progressStats.total > 0 && (
                      <div className="mt-3 max-w-md">
                        <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                          <span>Overall syllabus coverage</span>
                          <span>{progressStats.completed} / {progressStats.total} chapters</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary via-violet-500 to-emerald-500 transition-all duration-700"
                            style={{ width: `${progressStats.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {progressStats.total > 0 && (
                      <ProgressRing percent={progressStats.percent} />
                    )}
                    {canManage && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={openEditDialog}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setShowDelete(true)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-1 border-b border-border">
                {tabs.map(({ id, label, icon: Icon, ...rest }) => {
                  const count = 'count' in rest ? rest.count : undefined;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={cn(
                        'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                        activeTab === id
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {count !== undefined && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'students' && (
                <Card className="surface-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserPlus className="h-4 w-4 text-primary" />
                      Students
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {canManage ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                        <select
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                          value={enrollCandidateId}
                          onChange={(e) => setEnrollCandidateId(e.target.value)}
                        >
                          <option value="">Choose a student…</option>
                          {availableCandidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.user.firstName} {c.user.lastName} — {c.registrationNumber}
                            </option>
                          ))}
                        </select>
                        <Input
                          placeholder="Roll no."
                          value={enrollRoll}
                          onChange={(e) => setEnrollRoll(e.target.value)}
                        />
                        <Button
                          disabled={!enrollCandidateId || enrollMutation.isPending}
                          onClick={() => enrollMutation.mutate()}
                        >
                          {enrollMutation.isPending ? 'Adding…' : 'Add'}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">View-only: you cannot enroll students.</p>
                    )}

                    {(batchDetail?.enrollments ?? []).length === 0 ? (
                      <EmptyState
                        icon={Users}
                        title="No students enrolled"
                        description={canManage ? 'Add a student above, or assign them from the Students page.' : 'No students in this batch yet.'}
                      />
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {(batchDetail?.enrollments ?? []).map((e) => (
                          <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {initials(e.candidate.user.firstName, e.candidate.user.lastName)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {e.candidate.user.firstName} {e.candidate.user.lastName}
                              </span>
                              <span className="block font-mono text-xs text-muted-foreground">
                                {e.candidate.registrationNumber}
                              </span>
                            </span>
                            {e.rollNumber && (
                              <Badge variant="outline" className="normal-case tracking-normal">
                                Roll {e.rollNumber}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'teachers' && canManage && (
                <Card className="surface-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserCog className="h-4 w-4 text-primary" />
                      Teachers
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Assign a teacher to a subject for this batch.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={assignTeacherUserId}
                        onChange={(e) => setAssignTeacherUserId(e.target.value)}
                      >
                        <option value="">Choose a teacher…</option>
                        {teacherOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.firstName} {t.lastName} — {t.email}
                          </option>
                        ))}
                      </select>
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={assignSubjectId}
                        onChange={(e) => setAssignSubjectId(e.target.value)}
                      >
                        <option value="">Choose a subject…</option>
                        {batchSubjects.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <Button
                        disabled={!assignTeacherUserId || !assignSubjectId || assignTeacherMutation.isPending}
                        onClick={() => assignTeacherMutation.mutate()}
                      >
                        {assignTeacherMutation.isPending ? 'Assigning…' : 'Assign'}
                      </Button>
                    </div>

                    {teacherOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No teachers yet. Create one under{' '}
                        <Link href="/dashboard/users" className="font-medium text-primary hover:underline">
                          Staff &amp; Teachers
                        </Link>
                        .
                      </p>
                    )}

                    {teachersLoading ? (
                      <TableSkeleton rows={3} />
                    ) : (batchTeachers ?? []).length === 0 ? (
                      <EmptyState
                        icon={UserCog}
                        title="No teachers assigned"
                        description="Choose a teacher and subject above."
                      />
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {(batchTeachers ?? []).map((a) => (
                          <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {a.user ? initials(a.user.firstName, a.user.lastName) : '?'}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Unknown teacher'}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {a.user?.email ?? a.userId}
                              </span>
                            </span>
                            <Badge variant="secondary" className="normal-case tracking-normal shrink-0">
                              {a.subject.name}
                            </Badge>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="shrink-0 text-destructive hover:text-destructive"
                              title="Remove assignment"
                              disabled={removeTeacherMutation.isPending}
                              onClick={() => removeTeacherMutation.mutate(a.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'syllabus' && (
                <div className="space-y-4">
                  {progressLoading ? (
                    <TableSkeleton rows={6} />
                  ) : !(progress ?? []).length ? (
                    <Card className="surface-card">
                      <EmptyState
                        icon={BookOpen}
                        title="No books for this class yet"
                        description={
                          teacherPortal
                            ? 'Ask your admin to upload NCERT books. Chapters appear here after indexing.'
                            : 'Upload NCERT books for this class. Chapters appear here after indexing.'
                        }
                      />
                      {!teacherPortal && (
                        <div className="flex justify-center gap-3 pb-8">
                          <Button asChild>
                            <Link href="/dashboard/materials">
                              <Upload className="mr-2 h-4 w-4" /> Upload books
                            </Link>
                          </Button>
                          <Button variant="outline" asChild>
                            <Link href="/dashboard/syllabus">View syllabus</Link>
                          </Button>
                        </div>
                      )}
                    </Card>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {(progress ?? []).map((sp) => {
                          const subjProgress = calcProgress([sp]);
                          const isActive = activeSubject?.subject.id === sp.subject.id;
                          return (
                            <button
                              key={sp.subject.id}
                              type="button"
                              onClick={() => setSelectedSubjectId(sp.subject.id)}
                              className={cn(
                                'rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                                isActive
                                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                  : 'border-border/60 bg-card hover:border-primary/40 hover:bg-muted/40',
                              )}
                            >
                              {sp.subject.name}
                              <span className={cn(
                                'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                                isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                              )}>
                                {subjProgress.percent}%
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {activeSubject && (
                        <Card className="surface-card">
                          <CardHeader className="border-b border-border/60 pb-4">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <CardTitle className="text-lg">{activeSubject.subject.name}</CardTitle>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Mark chapters so AI tests only use studied content.
                                </p>
                              </div>
                              <Badge variant="outline" className="normal-case tracking-normal shrink-0">
                                {activeSubject.chapters.filter((c) => c.status === 'COMPLETED').length}
                                /{activeSubject.chapters.length} done
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-1.5 p-3 sm:p-4">
                            {activeSubject.chapters.map((ch) => {
                              const st = STATUS_CONFIG[ch.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.NOT_STARTED;
                              return (
                                <div
                                  key={ch.id}
                                  className="rounded-xl border border-border/40 bg-muted/15 px-3.5 py-3 transition-colors hover:border-border/70 hover:bg-muted/35"
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background', st.dot)} />
                                      <p className="min-w-0 truncate text-sm font-semibold">
                                        <span className="mr-1.5 inline-flex rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-primary shadow-sm">
                                          Ch.{ch.number}
                                        </span>
                                        {ch.title}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 gap-0.5 rounded-lg border border-border/60 bg-card p-0.5 shadow-sm sm:ml-4">
                                      {(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const).map((s) => {
                                        const cfg = STATUS_CONFIG[s];
                                        const active = ch.status === s;
                                        return (
                                          <button
                                            key={s}
                                            type="button"
                                            disabled={updateProgress.isPending}
                                            onClick={() => updateProgress.mutate({ chapterId: ch.id, status: s })}
                                            className={cn(
                                              'rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all',
                                              active ? cfg.active : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                            )}
                                          >
                                            {cfg.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create batch</DialogTitle>
            <DialogDescription>
              A batch groups students in the same class for tests and syllabus tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Batch name</Label>
              <Input
                placeholder="e.g. Section A, Morning Batch"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Class</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.academicClassId}
                onChange={(e) => setForm({ ...form, academicClassId: e.target.value })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>Class {c.level} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Academic year</Label>
              <Input
                value={form.academicYear}
                onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                placeholder="2025-26"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!form.name || !form.academicClassId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit batch</DialogTitle>
            <DialogDescription>
              Update the batch name, class, or academic year.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Batch name</Label>
              <Input
                placeholder="e.g. Section A, Morning Batch"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Class</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={editForm.academicClassId}
                onChange={(e) => setEditForm({ ...editForm, academicClassId: e.target.value })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>Class {c.level} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Academic year</Label>
              <Input
                value={editForm.academicYear}
                onChange={(e) => setEditForm({ ...editForm, academicYear: e.target.value })}
                placeholder="2025-26"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!editForm.name || !editForm.academicClassId || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete batch?</DialogTitle>
            <DialogDescription>
              {selectedBatchMeta && (
                <>
                  <span className="font-medium text-foreground">
                    {selectedBatchMeta.name}
                  </span>{' '}
                  ({selectedBatchMeta.academicClass.name}, {selectedBatchMeta.academicYear}) will be permanently removed.
                  {selectedBatchMeta._count.enrollments > 0 && (
                    <>
                      {' '}
                      <strong>{selectedBatchMeta._count.enrollments}</strong> enrolled student(s) will become unassigned.
                    </>
                  )}
                  {' '}Syllabus progress and teacher assignments for this batch will also be removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !selectedBatch}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
