'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { batchesApi, candidatesApi, curriculumApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/layout/page-header';
import { HorizontalTabScroller, ScrollableListPanel } from '@/components/layout/horizontal-tab-scroller';
import { DataTable, DataTableHeader, DataTableHead, DataTableRow, DataTableCell, EmptyState } from '@/components/layout/data-table';
import { StatCard } from '@/components/layout/stat-card';
import { CreateCandidateDialog } from '@/components/admin/create-candidate-dialog';
import { InviteCandidateDialog } from '@/components/admin/invite-candidate-dialog';
import { EditCandidateDialog, type EditableCandidate } from '@/components/admin/edit-candidate-dialog';
import {
  ManageCandidateBatchDialog,
  type BatchManageCandidate,
} from '@/components/admin/manage-candidate-batch-dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ArrowUpDown, ChevronDown, Search, Users, CheckCircle2, Clock, UserCheck, Pencil, Trash2, GraduationCap, Eye, Mail,
} from 'lucide-react';
import { ReviewKycDialog, type KycReviewCandidate } from '@/components/admin/review-kyc-dialog';
import {
  ViewCandidateDetailsDialog,
  type CandidateDetailsView,
} from '@/components/admin/view-candidate-details-dialog';
import { PaginationControls } from '@/components/layout/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { useNotificationStore } from '@/stores/notification-store';

type CandidateItem = {
  id: string;
  registrationNumber: string;
  gender?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  kycStatus: string;
  kycSubmittedAt?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string } | null;
  user: { firstName: string; lastName: string; email: string; phone?: string | null; status: string };
  batchEnrollments?: {
    id: string;
    rollNumber?: string | null;
    batch: {
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number };
    };
  }[];
};

const KYC_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_SUBMITTED: 'outline',
};

function getEnrollment(c: CandidateItem) {
  const e = c.batchEnrollments?.[0];
  if (!e) return null;
  return {
    batchId: e.batch.id,
    batchName: e.batch.name,
    classId: e.batch.academicClass.id,
    className: e.batch.academicClass.name,
    classLevel: e.batch.academicClass.level,
    academicYear: e.batch.academicYear,
    rollNumber: e.rollNumber,
  };
}

function classFilterLabel(cls: { level: number; name: string }) {
  if (/class\s*\d/i.test(cls.name)) return cls.name;
  return `Class ${cls.level}`;
}

function classEnrollmentLabel(level: number, name?: string) {
  if (name && /class\s*\d/i.test(name)) return name;
  return `Class ${level}`;
}

type ClassTab = 'all' | string;
type RosterView = 'students' | 'invites';
type NameSort = 'roll' | 'name-asc' | 'name-desc';

function rollRank(student: CandidateItem) {
  const raw = getEnrollment(student)?.rollNumber ?? '';
  const digits = String(raw).replace(/\D/g, '');
  const value = digits ? Number.parseInt(digits, 10) : Number.NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function sortStudentsByMode(
  students: CandidateItem[],
  nameSort: NameSort,
  rollCompare: (a: CandidateItem, b: CandidateItem) => number,
) {
  if (nameSort === 'name-asc' || nameSort === 'name-desc') {
    return [...students].sort((a, b) => {
      const nameA = `${a.user.firstName} ${a.user.lastName}`.trim();
      const nameB = `${b.user.firstName} ${b.user.lastName}`.trim();
      const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      return nameSort === 'name-asc' ? cmp : -cmp;
    });
  }
  return [...students].sort(rollCompare);
}

function compareStudents(a: CandidateItem, b: CandidateItem) {
  const rollDiff = rollRank(a) - rollRank(b);
  if (rollDiff !== 0) return rollDiff;
  const nameA = `${a.user.firstName} ${a.user.lastName}`.trim();
  const nameB = `${b.user.firstName} ${b.user.lastName}`.trim();
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

function groupStudentsByClass(
  students: CandidateItem[],
  sortedClasses: { id: string; level: number; name: string }[],
) {
  const byClassId = new Map<string, CandidateItem[]>();

  for (const c of students) {
    const enrollment = getEnrollment(c);
    if (!enrollment) {
      continue;
    }
    const list = byClassId.get(enrollment.classId) ?? [];
    list.push(c);
    byClassId.set(enrollment.classId, list);
  }

  const knownClassIds = new Set(sortedClasses.map((cls) => cls.id));

  const groups = sortedClasses
    .map((cls) => ({
      classId: cls.id,
      className: cls.name,
      classLevel: cls.level,
      students: byClassId.get(cls.id) ?? [],
    }))
    .filter((g) => g.students.length > 0);

  const orphanGroups = [...byClassId.entries()]
    .filter(([classId]) => !knownClassIds.has(classId))
    .map(([classId, classStudents]) => {
      const enrollment = getEnrollment(classStudents[0])!;
      return {
        classId,
        className: enrollment.className,
        classLevel: enrollment.classLevel,
        students: classStudents,
      };
    })
    .sort((a, b) => a.classLevel - b.classLevel || a.className.localeCompare(b.className));

  return { groups: [...groups, ...orphanGroups] };
}

export default function CandidatesPage() {
  const { accessToken } = useRequireAuth(true);
  const { can, synced } = usePermissions();
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const queryClient = useQueryClient();
  const classRegistrationHighlights = useNotificationStore((s) => s.classRegistrationHighlights);
  const clearClassRegistrationHighlight = useNotificationStore((s) => s.clearClassRegistrationHighlight);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [classTab, setClassTab] = useState<ClassTab>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [editCandidate, setEditCandidate] = useState<EditableCandidate | null>(null);
  const [batchCandidate, setBatchCandidate] = useState<BatchManageCandidate | null>(null);
  const [expandedClassSections, setExpandedClassSections] = useState<Record<string, boolean>>({});
  const [rosterView, setRosterView] = useState<RosterView>('students');
  const [nameSort, setNameSort] = useState<NameSort>('roll');
  const [removeTarget, setRemoveTarget] = useState<CandidateItem | null>(null);
  const [kycReviewCandidate, setKycReviewCandidate] = useState<KycReviewCandidate | null>(null);
  const [viewCandidate, setViewCandidate] = useState<CandidateDetailsView | null>(null);
  const debouncedSearch = useDebounce(search);

  function openStudentDetails(c: CandidateItem) {
    const enrollment = getEnrollment(c);
    setViewCandidate({
      id: c.id,
      registrationNumber: c.registrationNumber,
      gender: c.gender,
      guardianName: c.guardianName,
      guardianPhone: c.guardianPhone,
      kycStatus: c.kycStatus,
      createdAt: c.createdAt,
      createdBy: c.createdBy,
      user: c.user,
      enrollment: enrollment
        ? {
            className: enrollment.className,
            classLevel: enrollment.classLevel,
            batchName: enrollment.batchName,
            academicYear: enrollment.academicYear,
            rollNumber: enrollment.rollNumber,
          }
        : null,
    });
  }

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setSearch(q);
      setClassTab('all');
      setBatchFilter('');
      setPage(1);
    }
  }, [searchParams]);

  useEffect(() => {
    const kycReviewId = searchParams.get('kycReview');
    if (!kycReviewId || !accessToken) return;
    let cancelled = false;
    void candidatesApi.getKycReview(accessToken, kycReviewId).then((detail) => {
      if (cancelled) return;
      setKycReviewCandidate({
        id: detail.id,
        registrationNumber: detail.registrationNumber,
        firstName: detail.user.firstName,
        lastName: detail.user.lastName,
        email: detail.user.email,
      });
    }).catch(() => { /* invalid id or no access */ });
    return () => { cancelled = true; };
  }, [searchParams, accessToken]);

  const listFilters = useMemo(() => ({
    academicClassId: classTab !== 'all' ? classTab : undefined,
    batchId: batchFilter || undefined,
  }), [classTab, batchFilter]);

  const showGroupedByClass = classTab === 'all' && !batchFilter && !debouncedSearch;

  /** API caps limit at 100; grouped view always loads from page 1 (avoids empty page after paginating). */
  const listLimit = showGroupedByClass ? 100 : 20;
  const listPage = showGroupedByClass ? 1 : page;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['candidates', debouncedSearch, listPage, listFilters, listLimit],
    queryFn: () => candidatesApi.list(accessToken!, listPage, debouncedSearch, listLimit, listFilters),
    enabled: !!accessToken,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{ id: string; level: number; name: string }[]>,
    enabled: !!accessToken,
  });

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<{
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number };
    }[]>,
    enabled: !!accessToken,
  });

  const sortedClasses = useMemo(
    () => [...(classes ?? [])].sort((a, b) => a.level - b.level),
    [classes],
  );

  const batchesForFilter = useMemo(() => {
    const list = batches ?? [];
    const classId = classTab !== 'all' ? classTab : '';
    if (!classId) return [...list].sort((a, b) => a.academicClass.level - b.academicClass.level || a.name.localeCompare(b.name));
    return list
      .filter((b) => b.academicClass.id === classId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [batches, classTab]);

  const items = (data?.items || []) as CandidateItem[];

  const { groups: classGroups } = useMemo(
    () => groupStudentsByClass(items, sortedClasses),
    [items, sortedClasses],
  );

  const tabCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const c of items) {
      const enrollment = getEnrollment(c);
      if (!enrollment) continue;
      byClass.set(enrollment.classId, (byClass.get(enrollment.classId) ?? 0) + 1);
    }
    return { byClass, total: items.length };
  }, [items]);

  const countsAreComplete = showGroupedByClass && (data?.total ?? 0) <= listLimit;

  const canInviteStudent = synced && can(Permission.CANDIDATE_INVITE);

  const { data: inviteData, isLoading: invitesLoading } = useQuery({
    queryKey: ['registration-invites'],
    queryFn: () => candidatesApi.listRegistrationInvites(accessToken!, 1, 50),
    enabled: !!accessToken && canInviteStudent,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: kycStats } = useQuery({
    queryKey: ['candidates-stats'],
    queryFn: () => candidatesApi.stats(accessToken!) as Promise<{
      total: number;
      verified: number;
      pending: number;
      rejected?: number;
      byClass?: { academicClassId: string; level: number; count: number }[];
    }>,
    enabled: !!accessToken,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const enrollmentCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    if (kycStats?.byClass) {
      for (const row of kycStats.byClass) {
        byClass.set(row.academicClassId, row.count);
      }
    }
    return {
      byClass,
      total: kycStats?.total,
      ready: kycStats?.byClass != null,
    };
  }, [kycStats]);

  const resolveClassCount = (classId: string): number | null => {
    if (enrollmentCounts.ready) return enrollmentCounts.byClass.get(classId) ?? 0;
    if (countsAreComplete) return tabCounts.byClass.get(classId) ?? 0;
    return null;
  };

  const resolveAllCount = (): number | null => {
    if (enrollmentCounts.ready && enrollmentCounts.total != null) return enrollmentCounts.total;
    if (countsAreComplete) return tabCounts.total;
    return null;
  };

  const kycMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'VERIFIED' | 'REJECTED' }) =>
      candidatesApi.verifyKyc(accessToken!, id, status),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast({
        title: status === 'VERIFIED' ? 'KYC verified' : 'KYC rejected',
        variant: 'success',
      });
    },
    onError: (e: Error) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => candidatesApi.remove(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      toast({ title: 'Student removed from institute', variant: 'success' });
      setRemoveTarget(null);
    },
    onError: (e: Error) => toast({ title: 'Remove failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <TableSkeleton rows={6} cols={9} />;

  const totalPages = data?.totalPages ?? 1;
  const activeClassMeta =
    classTab !== 'all'
      ? sortedClasses.find((c) => c.id === classTab)
      : null;

  const renderStudentRows = (students: CandidateItem[], showClassColumn: boolean) =>
    students.map((c) => {
      const enrollment = getEnrollment(c);
      return (
        <DataTableRow key={c.id}>
          <DataTableCell className="font-mono text-xs font-semibold text-primary">
            {c.registrationNumber}
          </DataTableCell>
          <DataTableCell className="min-w-[10rem] max-w-[14rem]">
            <div className="font-medium">{c.user.firstName} {c.user.lastName}</div>
            <div className="text-xs text-muted-foreground break-all">{c.user.email}</div>
          </DataTableCell>
          <DataTableCell className="text-sm whitespace-nowrap">{c.gender || '—'}</DataTableCell>
          {showClassColumn && (
            <DataTableCell>
              {enrollment ? (
                <Badge variant="outline" className="normal-case">
                  {classEnrollmentLabel(enrollment.classLevel, enrollment.className)}
                </Badge>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </DataTableCell>
          )}
          <DataTableCell>
            {enrollment ? (
              <div className="space-y-0.5">
                <span className="text-sm font-medium">
                  {!showClassColumn && (
                    <>
                      {classEnrollmentLabel(enrollment.classLevel, enrollment.className)}
                      {' · '}
                    </>
                  )}
                  {enrollment.batchName}
                </span>
                {enrollment.rollNumber && (
                  <div className="text-xs text-muted-foreground">Roll {enrollment.rollNumber}</div>
                )}
              </div>
            ) : (
              can(Permission.BATCH_MANAGE) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setBatchCandidate({
                    id: c.id,
                    firstName: c.user.firstName,
                    lastName: c.user.lastName,
                    enrollment: null,
                  })}
                >
                  Assign batch
                </Button>
              ) : (
                <span className="text-sm text-amber-600">Unassigned</span>
              )
            )}
          </DataTableCell>
          <DataTableCell>
            <Badge variant={c.user.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {c.user.status}
            </Badge>
          </DataTableCell>
          <DataTableCell>
            <Badge variant={KYC_VARIANTS[c.kycStatus] ?? 'outline'}>
              {c.kycStatus.replace('_', ' ')}
            </Badge>
          </DataTableCell>
          <DataTableCell className="min-w-[6.5rem] max-w-[9rem] whitespace-normal text-sm">
            <span className="line-clamp-2" title={c.createdBy?.name || 'Self-registered'}>
              {c.createdBy?.name || 'Self-registered'}
            </span>
          </DataTableCell>
          <DataTableCell className="whitespace-nowrap text-muted-foreground text-xs">
            {new Date(c.createdAt).toLocaleDateString()}
          </DataTableCell>
          <DataTableCell className="whitespace-nowrap">
            <div className="flex flex-wrap items-center gap-1">
              {can(Permission.CANDIDATE_READ) && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="View student details"
                  onClick={() => openStudentDetails(c)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {can(Permission.BATCH_MANAGE) && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Class & batch"
                  onClick={() => setBatchCandidate({
                    id: c.id,
                    firstName: c.user.firstName,
                    lastName: c.user.lastName,
                    enrollment,
                  })}
                >
                  <GraduationCap className="h-4 w-4" />
                </Button>
              )}
              {can(Permission.CANDIDATE_UPDATE) && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Edit student"
                  onClick={() => setEditCandidate({
                    id: c.id,
                    registrationNumber: c.registrationNumber,
                    firstName: c.user.firstName,
                    lastName: c.user.lastName,
                    email: c.user.email,
                    status: c.user.status,
                  })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {can(Permission.CANDIDATE_DELETE) && c.user.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  title="Remove from institute"
                  onClick={() => setRemoveTarget(c)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              {can(Permission.CANDIDATE_KYC_VERIFY) && c.kycStatus === 'PENDING' && (
                <Button
                  size="sm"
                  variant="secondary"
                  title="View KYC documents"
                  onClick={() => setKycReviewCandidate({
                    id: c.id,
                    registrationNumber: c.registrationNumber,
                    firstName: c.user.firstName,
                    lastName: c.user.lastName,
                    email: c.user.email,
                  })}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                </Button>
              )}
              {can(Permission.CANDIDATE_KYC_VERIFY) && c.kycStatus === 'PENDING' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={kycMutation.isPending}
                  onClick={() => kycMutation.mutate({ id: c.id, status: 'VERIFIED' })}
                >
                  <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Verify
                </Button>
              )}
              {can(Permission.CANDIDATE_KYC_VERIFY) && c.kycStatus === 'PENDING' && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={kycMutation.isPending}
                  onClick={() => kycMutation.mutate({ id: c.id, status: 'REJECTED' })}
                >
                  Reject
                </Button>
              )}
            </div>
          </DataTableCell>
        </DataTableRow>
      );
    });

  function setClassSectionExpanded(sectionId: string, expanded: boolean) {
    setExpandedClassSections((current) => ({ ...current, [sectionId]: expanded }));
  }

  function cycleNameSort() {
    setNameSort((current) => (
      current === 'roll' ? 'name-asc' : current === 'name-asc' ? 'name-desc' : 'roll'
    ));
  }

  const renderStudentTable = (students: CandidateItem[], showClassColumn: boolean, compare = compareStudents) => {
    const ordered = sortStudentsByMode(students, nameSort, compare);
    return (
    <ScrollableListPanel maxHeightClass="max-h-[min(480px,55vh)]" className="overflow-x-auto">
    <DataTable>
      <table className="w-full min-w-[920px] table-fixed">
        <DataTableHeader>
          <DataTableHead className="w-[7.5rem]">Reg. no</DataTableHead>
          <DataTableHead className="w-[14rem]">
            <button
              type="button"
              className="inline-flex items-center gap-1 font-semibold hover:text-primary"
              onClick={cycleNameSort}
              title={
                nameSort === 'roll'
                  ? 'Sort by name (A–Z)'
                  : nameSort === 'name-asc'
                    ? 'Sorted A–Z · click for Z–A'
                    : 'Sorted Z–A · click for roll order'
              }
            >
              Student
              <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </DataTableHead>
          <DataTableHead className="w-[4.5rem]">Gender</DataTableHead>
          {showClassColumn && <DataTableHead className="w-[5.5rem]">Class</DataTableHead>}
          <DataTableHead className="w-[8rem]">Batch</DataTableHead>
          <DataTableHead className="w-[5.5rem]">Account</DataTableHead>
          <DataTableHead className="w-[5.5rem]">KYC</DataTableHead>
          <DataTableHead className="w-[6.5rem] whitespace-normal leading-tight">Added by</DataTableHead>
          <DataTableHead className="w-[5.5rem]">Joined</DataTableHead>
          <DataTableHead className="w-[8.5rem]">Actions</DataTableHead>
        </DataTableHeader>
        <tbody>{renderStudentRows(ordered, showClassColumn)}</tbody>
      </table>
      {!students.length && (
        <EmptyState
          icon={Users}
          title={
            debouncedSearch || classTab !== 'all' || batchFilter
              ? 'No students found'
              : 'No students yet'
          }
          description={
            debouncedSearch || classTab !== 'all' || batchFilter
              ? 'Try different filters or search terms.'
              : 'Add your first student and assign them to a class batch.'
          }
        />
      )}
    </DataTable>
    </ScrollableListPanel>
    );
  };

  const hasFilters = Boolean(debouncedSearch || batchFilter || classTab !== 'all');

  const inviteItems = inviteData?.items ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title={teacherPortal ? 'My Students' : 'Students'}
        description={
          teacherPortal
            ? 'Students enrolled in the classes you are assigned to teach'
            : 'Students grouped by class (IX–XII). Assign batches and track KYC.'
        }
        badge={data?.total != null ? `${data.total} total` : 'NCERT · Classes 9–12'}
      >
        {(canInviteStudent || can(Permission.CANDIDATE_CREATE)) && (
          <div className="flex flex-wrap items-center gap-2">
            {canInviteStudent && (
              <InviteCandidateDialog accessToken={accessToken!} batches={batches ?? []} classes={sortedClasses} />
            )}
            {can(Permission.CANDIDATE_CREATE) && (
              <CreateCandidateDialog accessToken={accessToken!} batches={batches ?? []} classes={sortedClasses} />
            )}
          </div>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard title="Total Students" value={kycStats?.total ?? data?.total ?? 0} icon={Users} accent="blue" />
        <StatCard title="KYC Verified" value={kycStats?.verified ?? 0} icon={CheckCircle2} accent="green" />
        <StatCard
          title="Pending Review"
          value={kycStats?.pending ?? 0}
          icon={Clock}
          accent="amber"
          trend={(kycStats?.pending ?? 0) > 0 ? 'Action needed' : undefined}
        />
      </div>
      
      <div className="space-y-4">
        {canInviteStudent && (
          <HorizontalTabScroller>
            <button
              type="button"
              onClick={() => setRosterView('students')}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                rosterView === 'students'
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              <Users className="h-4 w-4" />
              Students
            </button>
            <button
              type="button"
              onClick={() => setRosterView('invites')}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                rosterView === 'invites'
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              <Mail className="h-4 w-4" />
              Invites sent
              {inviteData?.total != null && (
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                  rosterView === 'invites' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                )}>
                  {inviteData.total}
                </span>
              )}
            </button>
          </HorizontalTabScroller>
        )}

        {rosterView === 'invites' ? (
          <Card className="surface-card overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <CardTitle className="text-lg">Pending student invites</CardTitle>
              <p className="text-sm text-muted-foreground">
                Students who received a signup link but have not registered yet.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {invitesLoading ? (
                <div className="p-6">
                  <TableSkeleton rows={4} cols={4} />
                </div>
              ) : inviteItems.length ? (
                <ScrollableListPanel maxHeightClass="max-h-[min(480px,55vh)]" className="overflow-x-auto">
                  <DataTable>
                    <table className="min-w-[640px] w-full">
                      <DataTableHeader>
                        <DataTableHead>Email</DataTableHead>
                        <DataTableHead>Name</DataTableHead>
                        <DataTableHead>Batch</DataTableHead>
                        <DataTableHead>Sent</DataTableHead>
                        <DataTableHead>Expires</DataTableHead>
                      </DataTableHeader>
                      <tbody>
                        {inviteItems.map((inv) => (
                          <DataTableRow key={inv.id}>
                            <DataTableCell className="font-medium">{inv.email}</DataTableCell>
                            <DataTableCell>
                              {[inv.firstName, inv.lastName].filter(Boolean).join(' ') || '—'}
                            </DataTableCell>
                            <DataTableCell className="text-sm text-muted-foreground">
                              {inv.batch
                                ? `${inv.batch.name} (${inv.batch.academicYear})`
                                : '—'}
                            </DataTableCell>
                            <DataTableCell className="text-xs text-muted-foreground">
                              {inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '—'}
                            </DataTableCell>
                            <DataTableCell className="text-xs text-muted-foreground">
                              {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}
                            </DataTableCell>
                          </DataTableRow>
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                </ScrollableListPanel>
              ) : (
                <EmptyState
                  icon={Mail}
                  title="No pending invites"
                  description="Create an invite to see students waiting to sign up here."
                />
              )}
            </CardContent>
          </Card>
        ) : (
        <>
        <HorizontalTabScroller>
          <button
            type="button"
            onClick={() => { setClassTab('all'); setBatchFilter(''); setPage(1); }}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
              classTab === 'all'
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
            )}
          >
            All classes
            {resolveAllCount() != null && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                classTab === 'all' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
              )}>
                {resolveAllCount()}
              </span>
            )}
          </button>
          {sortedClasses.map((cls) => {
            const active = classTab === cls.id;
            const count = resolveClassCount(cls.id);
            const newStudentHighlight = !!classRegistrationHighlights[cls.id];
            return (
              <button
                key={cls.id}
                type="button"
                onClick={() => {
                  setClassTab(cls.id);
                  setBatchFilter('');
                  setPage(1);
                  clearClassRegistrationHighlight(cls.id);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : newStudentHighlight
                      ? 'border-amber-400 bg-amber-100 text-amber-950 shadow-sm ring-1 ring-amber-300/80 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-50'
                      : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {classFilterLabel(cls)}
                {count != null && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    active
                      ? 'bg-white/20 text-white'
                      : newStudentHighlight
                        ? 'bg-amber-400 text-amber-950 dark:bg-amber-400 dark:text-amber-950'
                        : 'bg-muted text-muted-foreground',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </HorizontalTabScroller>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:max-w-sm sm:flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              name="student-list-search"
              autoComplete="off"
              placeholder="Search students…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto sm:min-w-[12rem] sm:max-w-xs sm:flex-1"
            value={batchFilter}
            onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }}
          >
            <option value="">All batches</option>
            {batchesForFilter.map((b) => (
              <option key={b.id} value={b.id}>
                {classEnrollmentLabel(b.academicClass.level, b.academicClass.name)} — {b.name}
              </option>
            ))}
          </select>
        </div>

      {showGroupedByClass ? (
        <ScrollableListPanel maxHeightClass="max-h-[min(75vh,800px)]" className="space-y-6">
          {classGroups.map((group) => {
            const expanded = expandedClassSections[group.classId] === true;
            return (
            <Card key={group.classId} className="surface-card overflow-hidden">
              <CardHeader
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={`${group.className}, ${group.students.length} students. ${expanded ? 'Collapse' : 'Expand'} list`}
                className={cn(
                  'cursor-pointer bg-muted/20 pb-4 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  expanded && 'border-b',
                )}
                onClick={() => setClassSectionExpanded(group.classId, !expanded)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setClassSectionExpanded(group.classId, !expanded);
                  }
                }}
              >
                <div className="flex w-full items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg">{group.className}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {group.students.length} student{group.students.length === 1 ? '' : 's'}
                      {' · '}
                      Class {group.classLevel}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                      !expanded && '-rotate-90',
                    )}
                    aria-hidden
                  />
                </div>
              </CardHeader>
              {expanded && (
              <CardContent className="p-0">
                {renderStudentTable(group.students, false)}
              </CardContent>
              )}
            </Card>
            );
          })}
          {!classGroups.length && (
            <Card className="surface-card">
              {renderStudentTable([], false)}
            </Card>
          )}
        </ScrollableListPanel>
      ) : (
        <>
          {activeClassMeta && (
            <Card className="surface-card overflow-hidden">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                    {activeClassMeta.level}
                  </span>
                  <div>
                    <CardTitle className="text-lg">{activeClassMeta.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {items.length} on this page
                      {data?.total != null ? ` · ${data.total} total` : ''}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderStudentTable(items, false)}
              </CardContent>
            </Card>
          )}
          {(classTab === 'all' && hasFilters) && (
            <Card className="surface-card overflow-hidden">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <CardTitle className="text-lg">Search results</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {renderStudentTable(items, true)}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!showGroupedByClass && totalPages > 1 && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          total={data?.total}
          onPageChange={(p) => setPage(p)}
        />
      )}

      {isFetching && !isLoading && (
        <p className="text-center text-xs text-muted-foreground">Updating...</p>
      )}
        </>
        )}
      </div>

      <EditCandidateDialog
        accessToken={accessToken!}
        candidate={editCandidate}
        open={!!editCandidate}
        onOpenChange={(open) => { if (!open) setEditCandidate(null); }}
      />

      <ViewCandidateDetailsDialog
        candidate={viewCandidate}
        open={!!viewCandidate}
        onOpenChange={(open) => { if (!open) setViewCandidate(null); }}
      />

      <ReviewKycDialog
        accessToken={accessToken!}
        candidate={kycReviewCandidate}
        open={!!kycReviewCandidate}
        onOpenChange={(open) => { if (!open) setKycReviewCandidate(null); }}
      />

      <ManageCandidateBatchDialog
        accessToken={accessToken!}
        candidate={batchCandidate}
        open={!!batchCandidate}
        onOpenChange={(open) => { if (!open) setBatchCandidate(null); }}
      />

      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove student from institute?</DialogTitle>
            <DialogDescription>
              {removeTarget && (
                <>
                  <span className="font-medium text-foreground">
                    {removeTarget.user.firstName} {removeTarget.user.lastName}
                  </span>{' '}
                  ({removeTarget.user.email}) will be deactivated, signed out, and removed from all batches.
                  Past exam results are kept. You can reactivate them later from Edit.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending || !removeTarget}
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              {removeMutation.isPending ? 'Removing…' : 'Remove student'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
