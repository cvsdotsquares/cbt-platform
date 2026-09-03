'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { usersApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Users, Pencil, Trash2, School } from 'lucide-react';
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

type UsersPageData = { items: UserItem[]; totalPages: number };

function primaryRole(user: UserItem) {
  return user.userRoles[0]?.role ?? null;
}

export default function UsersPage() {
  const { accessToken, user: currentUser } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editUser, setEditUser] = useState<EditableUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [assignTeacher, setAssignTeacher] = useState<UserItem | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['users', page],
    queryFn: () => usersApi.list(accessToken!, page) as Promise<UsersPageData>,
    enabled: !!accessToken,
    placeholderData: (prev) => prev,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.roles(accessToken!) as Promise<{ id: string; name: string }[]>,
    enabled: !!accessToken,
  });

  const roleList = roles || [];

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => usersApi.remove(accessToken!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User deactivated', variant: 'success' });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  const items = data?.items || [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Staff & Teachers"
        highlight="Teachers"
        description="Manage staff accounts, roles, and teacher class/subject assignments"
        badge={data ? `${items.length} on page` : 'Institute team'}
      >
        {can(Permission.USER_CREATE) && (
          <CreateUserDialog accessToken={accessToken!} roles={roleList} />
        )}
      </PageHeader>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
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
              {items.map((u) => {
                const role = primaryRole(u);
                const batches = u.assignedBatches ?? [];
                return (
                  <DataTableRow key={u.id}>
                    <DataTableCell className="font-medium">{u.firstName} {u.lastName}</DataTableCell>
                    <DataTableCell>{u.email}</DataTableCell>
                    <DataTableCell>
                      {role ? (
                        <Badge variant="secondary">{role.name}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
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
                          <span className="text-sm text-muted-foreground">Not assigned</span>
                        )
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      <Badge variant={u.status === 'ACTIVE' ? 'success' : 'warning'}>{u.status}</Badge>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
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
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title="Deactivate user"
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
          {!items.length && (
            <EmptyState
              icon={Users}
              title="No users found"
              description="Create your first user to get started."
            />
          )}
        </DataTable>
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
        roles={roleList}
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

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate user?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  <span className="font-medium text-foreground">
                    {deleteTarget.firstName} {deleteTarget.lastName}
                  </span>{' '}
                  ({deleteTarget.email}) will be set to <strong>Inactive</strong> and signed out of all sessions.
                  You can reactivate them later from Edit.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
