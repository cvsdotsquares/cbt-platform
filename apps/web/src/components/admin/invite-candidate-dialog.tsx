'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { candidatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Link2, MailPlus } from 'lucide-react';

type BatchOption = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
};

type ClassOption = { id: string; level: number; name: string };

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  registrationNumber: '',
  academicClassId: '',
  batchId: '',
};

interface InviteCandidateDialogProps {
  accessToken: string;
  batches?: BatchOption[];
  classes?: ClassOption[];
}

export function InviteCandidateDialog({ accessToken, batches = [], classes = [] }: InviteCandidateDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [signupUrl, setSignupUrl] = useState('');

  function resetFormForAnotherInvite() {
    setForm({ ...EMPTY_FORM });
    setSignupUrl('');
    setFormKey((k) => k + 1);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      resetFormForAnotherInvite();
    }
  }

  function handlePrimaryAction() {
    if (signupUrl) {
      resetFormForAnotherInvite();
      return;
    }
    inviteMutation.mutate();
  }

  const batchesForClass = useMemo(() => {
    if (!form.academicClassId) return [];
    return batches
      .filter((b) => b.academicClass.id === form.academicClassId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [batches, form.academicClassId]);

  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => a.level - b.level),
    [classes],
  );

  const inviteMutation = useMutation({
    mutationFn: () =>
      candidatesApi.createRegistrationInvite(accessToken, {
        email: form.email.trim().toLowerCase(),
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        registrationNumber: form.registrationNumber.trim() || undefined,
        batchId: form.batchId || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      queryClient.invalidateQueries({ queryKey: ['registration-invites'] });
      setSignupUrl(data.signupUrl);
      toast({ title: 'Invite created', description: 'Share the signup link with the student.', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Unable to create invite', description: e.message, variant: 'destructive' }),
  });

  async function copyLink() {
    if (!signupUrl) return;
    try {
      await navigator.clipboard.writeText(signupUrl);
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Copy failed', description: signupUrl, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline"><MailPlus className="mr-2 h-4 w-4" /> Invite Student</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite student</DialogTitle>
          <DialogDescription>
            Generate a one-time signup link for a school student. They must use this email to complete registration.
          </DialogDescription>
        </DialogHeader>
        <div key={formKey} className="grid gap-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>First name (optional)</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div><Label>Last name (optional)</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
          </div>
          <div>
            <Label>Student email</Label>
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div><Label>Registration no. (optional)</Label><Input value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} /></div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-sm font-medium">Class &amp; batch (optional)</p>
            <div>
              <Label>Class</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.academicClassId}
                onChange={(e) => setForm({ ...form, academicClassId: e.target.value, batchId: '' })}
              >
                <option value="">— None —</option>
                {sortedClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Batch</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.batchId}
                disabled={!form.academicClassId}
                onChange={(e) => setForm({ ...form, batchId: e.target.value })}
              >
                <option value="">— None —</option>
                {batchesForClass.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.academicYear})</option>
                ))}
              </select>
            </div>
          </div>

          {signupUrl && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Signup link</p>
              <p className="break-all text-xs text-muted-foreground">{signupUrl}</p>
              <Button type="button" variant="secondary" size="sm" onClick={copyLink}>
                <Link2 className="mr-2 h-4 w-4" /> Copy link
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            onClick={handlePrimaryAction}
            disabled={inviteMutation.isPending || (!signupUrl && !form.email.trim())}
          >
            {inviteMutation.isPending ? 'Creating…' : signupUrl ? 'Create another' : 'Create invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
