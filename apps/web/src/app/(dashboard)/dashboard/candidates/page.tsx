'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { batchesApi, candidatesApi, curriculumApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, DataTableHeader, DataTableHead, DataTableRow, DataTableCell, EmptyState } from '@/components/layout/data-table';
import { StatCard } from '@/components/layout/stat-card';
import { CreateCandidateDialog } from '@/components/admin/create-candidate-dialog';
import { EditCandidateDialog, type EditableCandidate } from '@/components/admin/edit-candidate-dialog';
import {
  ManageCandidateBatchDialog,
  type BatchManageCandidate,
} from '@/components/admin/manage-candidate-batch-dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { Search, Users, CheckCircle2, Clock, UserCheck, Pencil, Trash2, GraduationCap } from 'lucide-react';
import { PaginationControls } from '@/components/layout/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

type CandidateItem = {
  id: string;
  registrationNumber: string;
  kycStatus: string;
  createdAt: string;
  user: { firstName: string; lastName: string; email: string; status: string };
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

export default function CandidatesPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [classFilter, setClassFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [editCandidate, setEditCandidate] = useState<EditableCandidate | null>(null);
  const [batchCandidate, setBatchCandidate] = useState<BatchManageCandidate | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CandidateItem | null>(null);
  const debouncedSearch = useDebounce(search);

  const listFilters = useMemo(() => ({
    academicClassId: classFilter || undefined,
    batchId: batchFilter || undefined,
    unassigned: (!teacherPortal && showUnassigned) || undefined,
  }), [classFilter, batchFilter, showUnassigned, teacherPortal]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['candidates', debouncedSearch, page, listFilters],
    queryFn: () => candidatesApi.list(accessToken!, page, debouncedSearch, 20, listFilters),
    enabled: !!accessToken,
    placeholderData: (prev) => prev,
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
    if (!classFilter) return [...list].sort((a, b) => a.academicClass.level - b.academicClass.level || a.name.localeCompare(b.name));
    return list
      .filter((b) => b.academicClass.id === classFilter)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [batches, classFilter]);

  const { data: kycStats } = useQuery({
    queryKey: ['candidates-stats'],
    queryFn: () => candidatesApi.stats(accessToken!) as Promise<{ total: number; verified: number; pending: number }>,
    enabled: !!accessToken && !teacherPortal,
  });

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

  const items = (data?.items || []) as CandidateItem[];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title={teacherPortal ? 'My Students' : 'Students'}
        description={
          teacherPortal
            ? 'Students enrolled in the classes you are assigned to teach'
            : 'Manage students, assign them to class batches (IX–XII), and track KYC'
        }
        badge={data?.total != null ? `${data.total} total` : 'NCERT · Classes 9–12'}
      >
        {can(Permission.CANDIDATE_CREATE) && (
          <CreateCandidateDialog accessToken={accessToken!} batches={batches ?? []} classes={sortedClasses} />
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
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setBatchFilter('');
              setShowUnassigned(false);
              setPage(1);
            }}
          >
            <option value="">All classes</option>
            {sortedClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto sm:min-w-[12rem] sm:max-w-xs sm:flex-1"
            value={batchFilter}
            disabled={showUnassigned}
            onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }}
          >
            <option value="">All batches</option>
            {batchesForFilter.map((b) => (
              <option key={b.id} value={b.id}>
                {b.academicClass.name} — {b.name}
              </option>
            ))}
          </select>
          {!teacherPortal && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showUnassigned}
                onChange={(e) => {
                  setShowUnassigned(e.target.checked);
                  if (e.target.checked) setBatchFilter('');
                  setPage(1);
                }}
              />
              Unassigned only
            </label>
          )}
        </div>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Reg. No</DataTableHead>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Class</DataTableHead>
            <DataTableHead>Batch</DataTableHead>
            <DataTableHead>Account</DataTableHead>
            <DataTableHead>KYC</DataTableHead>
            <DataTableHead>Registered</DataTableHead>
            <DataTableHead>Actions</DataTableHead>
          </DataTableHeader>
          <tbody>
            {items.map((c) => {
              const enrollment = getEnrollment(c);
              return (
                <DataTableRow key={c.id}>
                  <DataTableCell className="font-mono text-xs font-semibold text-primary">
                    {c.registrationNumber}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="font-medium">{c.user.firstName} {c.user.lastName}</div>
                    <div className="text-xs text-muted-foreground">{c.user.email}</div>
                  </DataTableCell>
                  <DataTableCell>
                    {enrollment ? (
                      <Badge variant="outline" className="normal-case">{enrollment.className}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    {enrollment ? (
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium">{enrollment.batchName}</span>
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
                  <DataTableCell className="text-muted-foreground text-xs">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap items-center gap-1">
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
                      {can(Permission.CANDIDATE_KYC_VERIFY) && c.kycStatus !== 'VERIFIED' && (
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
            })}
          </tbody>
        </table>
        {!items.length && (
          <EmptyState
            icon={Users}
            title={debouncedSearch || classFilter || batchFilter || showUnassigned ? 'No students found' : 'No students yet'}
            description={
              debouncedSearch || classFilter || batchFilter || showUnassigned
                ? 'Try different filters or search terms.'
                : 'Add your first student and assign them to a class batch.'
            }
          />
        )}
      </DataTable>

      <PaginationControls
        page={page}
        totalPages={totalPages}
        total={data?.total}
        onPageChange={(p) => setPage(p)}
      />

      {isFetching && !isLoading && (
        <p className="text-center text-xs text-muted-foreground">Updating...</p>
      )}

      <EditCandidateDialog
        accessToken={accessToken!}
        candidate={editCandidate}
        open={!!editCandidate}
        onOpenChange={(open) => { if (!open) setEditCandidate(null); }}
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
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
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
