'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { usersApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export type EditableUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  roleId: string;
};

interface EditUserDialogProps {
  accessToken: string;
  user: EditableUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: { id: string; name: string }[];
  canAssignRole?: boolean;
}

export function EditUserDialog({
  accessToken,
  user,
  open,
  onOpenChange,
  roles,
  canAssignRole = true,
}: EditUserDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    status: 'ACTIVE',
    password: '',
    roleId: '',
  });

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        status: user.status,
        password: '',
        roleId: user.roleId,
      });
    }
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('No user selected');
      return usersApi.update(accessToken, user.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        status: form.status,
        ...(form.password.trim() ? { password: form.password } : {}),
        ...(canAssignRole ? { roleId: form.roleId || null } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User updated', variant: 'success' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update profile, role, status, or reset password.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>First name</Label>
              <Input
                name="edit-staff-first-name"
                autoComplete="off"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div>
              <Label>Last name</Label>
              <Input
                name="edit-staff-last-name"
                autoComplete="off"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              name="edit-staff-email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          {canAssignRole && (
            <div>
              <Label>Role</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">None</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Each staff member has one role.</p>
            </div>
          )}
          <div>
            <Label>Status</Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="PENDING_VERIFICATION">Pending verification</option>
            </select>
          </div>
          <div>
            <Label>New password (optional)</Label>
            <PasswordInput
              name="edit-staff-new-password"
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !form.firstName || !form.email}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
