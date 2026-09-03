'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { batchesApi, candidatesApi, curriculumApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export type BatchManageCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  enrollment?: {
    batchId: string;
    batchName: string;
    classId: string;
    className: string;
    classLevel: number;
    academicYear: string;
    rollNumber?: string | null;
  } | null;
};

interface ManageCandidateBatchDialogProps {
  accessToken: string;
  candidate: BatchManageCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BatchOption = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
};

export function ManageCandidateBatchDialog({
  accessToken,
  candidate,
  open,
  onOpenChange,
}: ManageCandidateBatchDialogProps) {
  const queryClient = useQueryClient();
  const [academicClassId, setAcademicClassId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [rollNumber, setRollNumber] = useState('');

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken) as Promise<{ id: string; level: number; name: string }[]>,
    enabled: open && !!accessToken,
  });

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken) as Promise<BatchOption[]>,
    enabled: open && !!accessToken,
  });

  const sortedClasses = useMemo(
    () => [...(classes ?? [])].sort((a, b) => a.level - b.level),
    [classes],
  );

  const batchesForClass = useMemo(() => {
    if (!academicClassId) return [];
    return (batches ?? [])
      .filter((b) => b.academicClass.id === academicClassId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [batches, academicClassId]);

  useEffect(() => {
    if (!candidate) return;
    if (candidate.enrollment) {
      setAcademicClassId(candidate.enrollment.classId);
      setBatchId(candidate.enrollment.batchId);
      setRollNumber(candidate.enrollment.rollNumber ?? '');
    } else {
      setAcademicClassId('');
      setBatchId('');
      setRollNumber('');
    }
  }, [candidate]);

  useEffect(() => {
    if (!batchId) return;
    const stillValid = batchesForClass.some((b) => b.id === batchId);
    if (!stillValid) setBatchId('');
  }, [academicClassId, batchesForClass, batchId]);

  const clearMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error('No student selected');
      return candidatesApi.setBatch(accessToken, candidate.id, { batchId: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast({ title: 'Batch assignment cleared', variant: 'success' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Could not clear batch', description: e.message, variant: 'destructive' }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error('No student selected');
      return candidatesApi.setBatch(accessToken, candidate.id, {
        batchId: batchId || null,
        rollNumber: rollNumber.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-detail'] });
      toast({ title: batchId ? 'Class & batch updated' : 'Batch assignment cleared', variant: 'success' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Could not update batch', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Class &amp; batch</DialogTitle>
          <DialogDescription>
            {candidate && (
              <>
                Assign <span className="font-medium text-foreground">{candidate.firstName} {candidate.lastName}</span>{' '}
                to one class batch (e.g. Class X — Batch B). A student can only be in one batch at a time.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label>Class</Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={academicClassId}
              onChange={(e) => setAcademicClassId(e.target.value)}
            >
              <option value="">Select class…</option>
              {sortedClasses.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} (Level {cls.level})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Batch</Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              value={batchId}
              disabled={!academicClassId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">
                {academicClassId ? 'Select batch…' : 'Choose a class first'}
              </option>
              {batchesForClass.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.academicYear}
                </option>
              ))}
            </select>
            {academicClassId && batchesForClass.length === 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No batches for this class yet. Create them under Classes &amp; Batches.
              </p>
            )}
          </div>
          <div>
            <Label>Roll number (optional)</Label>
            <Input
              placeholder="e.g. 12"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {candidate?.enrollment && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              disabled={saveMutation.isPending || clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
            >
              Clear assignment
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
