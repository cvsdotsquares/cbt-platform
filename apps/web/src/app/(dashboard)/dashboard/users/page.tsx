'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TableSkeleton } from '@/components/ui/skeleton';
import { usersApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Users, Pencil, Trash2, School, Search } from 'lucide-react';
import { CreateUserDialog } from '@/components/admin/create-user-dialog';
import { EditUserDialog, type EditableUser } from '@/components/admin/edit-user-dialog';
import { AssignTeacherClassesDialog } from '@/components/admin/assign-teacher-classes-dialog';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, DataTableHeader, DataTableHead, DataTableRow, DataTableCell, EmptyState } from '@/components/layout/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

type UserItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  lastLoginAt?: string;
  userRoles: { role: { id: string; name: string } }[];
  assignedBatches: { id: string; label: string }[];
};

type UsersPageData = { items: UserItem[]; totalPages: number; total?: number };

const ASSIGNABLE_ROLE_NAMES = new Set(['SUPER_ADMIN', 'TEACHER']);

function primaryRole(user: UserItem) {
  return user.userRoles[0]?.role ?? null;
}

function orNa(value: string | null | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed || 'N/A';
}

function displayUserName(user: UserItem) {
  return orNa(`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim());
}

export default function UsersPage() {
  const { accessToken, user: currentUser } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [editUser, setEditUser] = useState<EditableUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [assignTeacher, setAssignTeacher] = useState<UserItem | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['users', page, showInactive],
    queryFn: () => usersApi.list(accessToken!, page, '', 20, showInactive) as Promise<UsersPageData>,
    enabled: !!accessToken,
    placeholderData: (prev) => prev,
  });

  const { data: inactiveMeta } = useQuery({
    queryKey: ['users-inactive-count'],
    queryFn: () => usersApi.inactiveCount(accessToken!) as Promise<{ count: number }>,
    enabled: !!accessToken && can(Permission.USER_DELETE),
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.roles(accessToken!) as Promise<{ id: string; name: string }[]>,
    enabled: !!accessToken,
  });

  const assignableRoles = useMemo(
    () => (roles ?? []).filter((r) => ASSIGNABLE_ROLE_NAMES.has(r.name)),
    [roles],
  );

  const roleListForEdit = useMemo(() => {
    if (!editUser?.roleId) return assignableRoles;
    if (assignableRoles.some((r) => r.id === editUser.roleId)) return assignableRoles;
    const current = roles?.find((r) => r.id === editUser.roleId);
    return current ? [...assignableRoles, current] : assignableRoles;
  }, [assignableRoles, editUser, roles]);

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => usersApi.remove(accessToken!, userId),
    onSuccess: (_data, userId) => {
      queryClient.setQueryData(['users', page], (old: UsersPageData | undefined) => {
        if (!old) return old;
        const items = old.items.filter((u) => u.id !== userId);
        const total = old.total != null ? Math.max(0, old.total - 1) : old.total;
        return { ...old, items, total };
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-inactive-count'] });
      toast({ title: 'User deleted permanently', variant: 'success' });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  const purgeMutation = useMutation({
    mutationFn: () => usersApi.purgeInactive(accessToken!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-inactive-count'] });
      setPurgeOpen(false);
      const skipped = result.skipped ?? 0;
      toast({
        title: `Removed ${result.deleted} inactive account${result.deleted === 1 ? '' : 's'}`,
        description: skipped > 0 ? `${skipped} could not be removed (still linked to other data).` : undefined,
        variant: 'success',
      });
    },
    onError: (e: Error) => toast({ title: 'Cleanup failed', description: e.message, variant: 'destructive' }),
  });

  const items = data?.items || [];
  const inactiveCount = inactiveMeta?.count ?? 0;

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    let list = items;
    if (!showInactive) {
      list = list.filter((user) => user.status === 'ACTIVE');
    }
    if (!query) return list;

    return list.filter((user) => {
      const roleName = primaryRole(user)?.name ?? '';
      const batchText = (user.assignedBatches ?? []).map((b) => b.label).join(' ');
      const haystack = [user.firstName, user.lastName, user.email, roleName, batchText].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [items, searchTerm, showInactive]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Teachers"
        description="Manage teacher accounts and class/subject assignments"
        badge={data ? `${items.length} on page` : 'Institute team'}
      >
        {can(Permission.USER_CREATE) && (
          <CreateUserDialog accessToken={accessToken!} roles={assignableRoles} />
        )}
      </PageHeader>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowInactive((v) => !v)}
              >
                {showInactive ? 'Hide inactive accounts' : `Show inactive accounts (${inactiveCount})`}
              </Button>
              {can(Permission.USER_DELETE) && inactiveCount > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setPurgeOpen(true)}
                >
                  Remove all inactive permanently ({inactiveCount})
                </Button>
              )}
            </div>
            <div className="relative w-full max-w-sm sm:ml-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search teachers..."
                className="pl-9"
              />
            </div>
          </div>

          <DataTable>
            <table className="w-full">
              <DataTableHeader>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Email</DataTableHead>
                <DataTableHead>Role</DataTableHead>
                <DataTableHead>Batches</DataTableHead>
                <DataTableHead>Status</DataTableHead>
                <DataTableHead>Last Login</DataTableHead>
                <DataTableHead className="text-right">Actions</DataTableHead>
              </DataTableHeader>
              <tbody>
                {filteredItems.map((u) => {
                  const role = primaryRole(u);
                  const batches = u.assignedBatches ?? [];
                  return (
                    <DataTableRow key={u.id}>
                      <DataTableCell className="font-medium">{displayUserName(u)}</DataTableCell>
                      <DataTableCell>{orNa(u.email)}</DataTableCell>
                      <DataTableCell>
                        {role ? (
                          <Badge variant="secondary">{role.name}</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">N/A</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        {role?.name === 'TEACHER' ? (
                          batches.length ? (
                            <div className="flex max-w-[16rem] flex-wrap gap-1">
                              {batches.map((b) => (
                                <Badge key={b.id} variant="outline" className="font-normal normal-case tracking-normal">
                                  {b.label}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">N/A</span>
                          )
                        ) : (
                          <span className="text-sm text-muted-foreground">N/A</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        {u.status ? (
                          <Badge variant={u.status === 'ACTIVE' ? 'success' : 'warning'}>{u.status}</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">N/A</span>
                        )}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'N/A'}
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {can(Permission.BATCH_MANAGE) && role?.name === 'TEACHER' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Assign classes & subjects"
                              onClick={() => setAssignTeacher(u)}
                            >
                              <School className="h-4 w-4" />
                            </Button>
                          )}
                          {can(Permission.USER_UPDATE) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Edit user"
                              onClick={() => setEditUser({
                                id: u.id,
                                firstName: u.firstName,
                                lastName: u.lastName,
                                email: u.email,
                                status: u.status,
                                roleId: role?.id ?? '',
                              })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {can(Permission.USER_DELETE) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              title="Delete user permanently"
                              disabled={u.id === currentUser?.id}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </table>
            {!filteredItems.length && (
              <EmptyState
                icon={Users}
                title={
                  items.length && !showInactive && inactiveCount > 0
                    ? 'No active users on this page'
                    : items.length
                      ? 'No matching users'
                      : 'No users found'
                }
                description={
                  items.length && !showInactive && inactiveCount > 0
                    ? 'Use “Show inactive accounts” to view inactive staff, or create a new account.'
                    : items
                      ? 'Try a different name, email, role, or batch.'
                      : 'Create your first user to get started.'
                }
              />
            )}
          </DataTable>
        </div>
      )}

      {isFetching && !isLoading && (
        <p className="text-center text-xs text-muted-foreground">Updating...</p>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="flex items-center text-sm text-muted-foreground">Page {page} of {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      <EditUserDialog
        accessToken={accessToken!}
        user={editUser}
        roles={roleListForEdit}
        canAssignRole={can(Permission.USER_ASSIGN_ROLE) || can(Permission.USER_UPDATE)}
        open={!!editUser}
        onOpenChange={(open) => { if (!open) setEditUser(null); }}
      />

      <AssignTeacherClassesDialog
        accessToken={accessToken!}
        teacher={assignTeacher}
        open={!!assignTeacher}
        onOpenChange={(open) => { if (!open) setAssignTeacher(null); }}
      />

      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove all inactive staff?</DialogTitle>
            <DialogDescription>
              This permanently deletes <strong>{inactiveCount}</strong> inactive staff account
              {inactiveCount === 1 ? '' : 's'} from the database (roles, sessions, teacher assignments).
              Active accounts are not affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={purgeMutation.isPending || inactiveCount <= 0}
              onClick={() => purgeMutation.mutate()}
            >
              {purgeMutation.isPending ? 'Removing…' : 'Remove all permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user permanently?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  <span className="font-medium text-foreground">
                    {deleteTarget.firstName} {deleteTarget.lastName}
                  </span>{' '}
                  ({deleteTarget.email}) will be removed from the institute. This cannot be undone.
                  Their roles, sessions, and teacher assignments will be removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
