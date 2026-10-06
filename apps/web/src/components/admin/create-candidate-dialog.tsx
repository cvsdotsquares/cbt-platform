'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { candidatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';

type BatchOption = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
};

type ClassOption = { id: string; level: number; name: string };

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  gender: '',
  studentMobile: '',
  guardianName: '',
  guardianPhone: '',
  registrationNumber: '',
  academicClassId: '',
  batchId: '',
  rollNumber: '',
};

interface CreateCandidateDialogProps {
  accessToken: string;
  batches?: BatchOption[];
  classes?: ClassOption[];
}

function isCreateFormValid(form: typeof EMPTY_FORM) {
  return Boolean(
    form.firstName.trim()
    && form.lastName.trim()
    && form.email.trim()
    && form.password
    && form.gender
    && form.studentMobile.trim()
    && form.guardianName.trim()
    && form.guardianPhone.trim()
    && form.academicClassId
    && form.batchId,
  );
}

export function CreateCandidateDialog({ accessToken, batches = [], classes = [] }: CreateCandidateDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setForm({ ...EMPTY_FORM });
      setFormKey((k) => k + 1);
    }
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

  const formValid = isCreateFormValid(form);

  const createMutation = useMutation({
    mutationFn: () =>
      candidatesApi.create(accessToken, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        gender: form.gender,
        studentMobile: form.studentMobile.trim(),
        guardianName: form.guardianName.trim(),
        guardianPhone: form.guardianPhone.trim(),
        registrationNumber: form.registrationNumber.trim() || undefined,
        batchId: form.batchId,
        rollNumber: form.rollNumber.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast({ title: 'Student created', variant: 'success' });
      setOpen(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: Error) => toast({ title: 'Unable to create student', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> Add Student</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Student</DialogTitle>
          <DialogDescription>Register a new student and assign them to a class batch.</DialogDescription>
        </DialogHeader>
        <div key={formKey} className="grid gap-4 py-2">
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden="true" />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>First name</Label>
              <Input name="new-student-first-name" autoComplete="off" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input name="new-student-last-name" autoComplete="off" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>Gender</Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="">Select gender…</option>
              {GENDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>Student mobile number</Label>
            <Input type="tel" autoComplete="off" required value={form.studentMobile} onChange={(e) => setForm({ ...form, studentMobile: e.target.value })} />
          </div>

          <div>
            <Label>Student email address</Label>
            <Input type="email" name="new-student-email" autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>

          <div>
            <Label>Password</Label>
            <PasswordInput name="new-student-password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Parent / guardian full name</Label>
              <Input autoComplete="off" required value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
            </div>
            <div>
              <Label>Parent / guardian mobile number</Label>
              <Input type="tel" autoComplete="off" required value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>Registration no. (optional)</Label>
            <Input autoComplete="off" value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} placeholder="Auto-generated if empty" />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-sm font-medium">Class &amp; batch</p>
            <div>
              <Label>Class</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
                value={form.academicClassId}
                onChange={(e) => setForm({ ...form, academicClassId: e.target.value, batchId: '' })}
              >
                <option value="">Select class…</option>
                {sortedClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Batch</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                required
                value={form.batchId}
                disabled={!form.academicClassId}
                onChange={(e) => setForm({ ...form, batchId: e.target.value })}
              >
                <option value="">{form.academicClassId ? 'Select batch…' : 'Choose class first'}</option>
                {batchesForClass.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} · {b.academicYear}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Roll number (optional)</Label>
              <Input value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} placeholder="Auto from 1 by name" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !formValid}
          >
            {createMutation.isPending ? 'Creating…' : 'Create student'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
