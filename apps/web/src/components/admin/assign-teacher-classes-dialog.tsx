'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { batchesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { School, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type TeachingAssignment = {
  id: string;
  batchId: string;
  subjectId: string;
  subject: { id: string; name: string; code?: string };
  batch: {
    id: string;
    name: string;
    academicYear: string;
    academicClass: { id: string; name: string; level: number };
  };
};

function assignmentBatchId(a: TeachingAssignment): string {
  return a.batchId || a.batch?.id || a.id;
}

type BatchOption = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
};

type StaffTeacher = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

interface AssignTeacherClassesDialogProps {
  accessToken: string;
  teacher: StaffTeacher | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignTeacherClassesDialog({
  accessToken,
  teacher,
  open,
  onOpenChange,
}: AssignTeacherClassesDialogProps) {
  const queryClient = useQueryClient();
  const [batchId, setBatchId] = useState('');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken) as Promise<BatchOption[]>,
    enabled: open && !!accessToken,
  });

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['teacher-assignments', teacher?.id],
    queryFn: () =>
      batchesApi.listTeacherAssignmentsByUser(accessToken, teacher!.id) as Promise<TeachingAssignment[]>,
    enabled: open && !!accessToken && !!teacher?.id,
  });

  const { data: batchDetail } = useQuery({
    queryKey: ['batch-detail', batchId],
    queryFn: () => batchesApi.get(accessToken, batchId) as Promise<{
      academicClass: { subjects?: { id: string; name: string }[] };
    }>,
    enabled: open && !!accessToken && !!batchId,
  });

  const subjects = batchDetail?.academicClass.subjects ?? [];

  const assignedSubjectIdsForBatch = useMemo(() => {
    if (!batchId) return new Set<string>();
    return new Set(
      (assignments ?? [])
        .filter((a) => assignmentBatchId(a) === batchId)
        .map((a) => a.subjectId),
    );
  }, [assignments, batchId]);

  const availableSubjects = useMemo(
    () => subjects.filter((s) => !assignedSubjectIdsForBatch.has(s.id)),
    [subjects, assignedSubjectIdsForBatch],
  );

  const sortedBatches = useMemo(
    () =>
      [...(batches ?? [])].sort(
        (a, b) =>
          a.academicClass.level - b.academicClass.level
          || a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [batches],
  );

  const assignmentsByBatch = useMemo(() => {
    const map = new Map<string, {
      batchId: string;
      label: string;
      year: string;
      items: TeachingAssignment[];
    }>();
    for (const a of assignments ?? []) {
      const key = assignmentBatchId(a);
      const existing = map.get(key);
      if (existing) {
        existing.items.push(a);
      } else {
        map.set(key, {
          batchId: key,
          label: `${a.batch.academicClass.name} — ${a.batch.name}`,
          year: a.batch.academicYear,
          items: [a],
        });
      }
    }
    return [...map.values()];
  }, [assignments]);

  function invalidateAssignments() {
    queryClient.invalidateQueries({ queryKey: ['teacher-assignments', teacher?.id] });
    queryClient.invalidateQueries({ queryKey: ['batch-teachers'] });
    queryClient.invalidateQueries({ queryKey: ['batches'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const assignMutation = useMutation({
    mutationFn: () =>
      batchesApi.assignTeacher(accessToken, batchId, {
        userId: teacher!.id,
        subjectIds: selectedSubjectIds,
      }),
    onSuccess: () => {
      invalidateAssignments();
      setSelectedSubjectIds([]);
      toast({
        title: 'Batch assigned',
        description: 'Pick another batch below to assign more classes.',
        variant: 'success',
      });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not assign', description: e.message, variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: (a: TeachingAssignment) =>
      batchesApi.removeTeacher(accessToken, assignmentBatchId(a), a.id),
    onSuccess: () => {
      invalidateAssignments();
      toast({ title: 'Assignment removed', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not remove', description: e.message, variant: 'destructive' }),
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setBatchId('');
      setSelectedSubjectIds([]);
    }
    onOpenChange(next);
  }

  function toggleSubject(id: string) {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllAvailable() {
    setSelectedSubjectIds(availableSubjects.map((s) => s.id));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <School className="h-5 w-5 text-primary" />
            Assign classes
          </DialogTitle>
          <DialogDescription>
            {teacher && (
              <>
                Assign{' '}
                <span className="font-medium text-foreground">
                  {teacher.firstName} {teacher.lastName}
                </span>{' '}
                to as many batches as you need. Each batch needs at least one subject.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Batch / Class</label>
              <select
                className="mt-1.5 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setSelectedSubjectIds([]);
                }}
              >
                <option value="">Choose batch…</option>
                {sortedBatches.map((b) => {
                  const assignedCount = (assignments ?? []).filter((a) => assignmentBatchId(a) === b.id).length;
                  return (
                    <option key={b.id} value={b.id}>
                      {b.academicClass.name} — {b.name} ({b.academicYear})
                      {assignedCount ? ` · ${assignedCount} subject${assignedCount === 1 ? '' : 's'} assigned` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Subjects</label>
                {availableSubjects.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={selectAllAvailable}
                  >
                    Select all
                  </button>
                )}
              </div>
              {!batchId ? (
                <p className="mt-2 text-sm text-muted-foreground">Choose a batch first.</p>
              ) : availableSubjects.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground">
                  {subjects.length === 0
                    ? 'No subjects for this class yet. Upload NCERT books first.'
                    : 'All subjects in this batch are already assigned. Pick another batch to continue.'}
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableSubjects.map((s) => {
                    const selected = selectedSubjectIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSubject(s.id)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <Button
              className="w-full"
              disabled={
                !batchId
                || selectedSubjectIds.length === 0
                || assignMutation.isPending
                || !teacher
              }
              onClick={() => assignMutation.mutate()}
            >
              {assignMutation.isPending
                ? 'Assigning…'
                : selectedSubjectIds.length > 1
                  ? `Assign ${selectedSubjectIds.length} subjects to this batch`
                  : 'Assign to this batch'}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              After assigning, choose another batch to add more classes.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Current assignments · {assignmentsByBatch.length} batch
              {assignmentsByBatch.length === 1 ? '' : 'es'}
            </p>
            {isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
            ) : assignmentsByBatch.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                No classes assigned yet. Add the first batch above.
              </p>
            ) : (
              assignmentsByBatch.map((group, index) => (
                <div
                  key={group.batchId || `assignment-group-${index}`}
                  className="rounded-xl border border-border/60 px-3 py-2.5 space-y-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{group.label}</p>
                    <p className="text-[11px] text-muted-foreground">{group.year}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((a) => (
                      <Badge
                        key={a.id}
                        variant="secondary"
                        className="gap-1 pr-1 normal-case tracking-normal"
                      >
                        {a.subject.name}
                        <button
                          type="button"
                          className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                          disabled={removeMutation.isPending}
                          title={`Remove ${a.subject.name}`}
                          aria-label={`Remove ${a.subject.name}`}
                          onClick={() => removeMutation.mutate(a)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
