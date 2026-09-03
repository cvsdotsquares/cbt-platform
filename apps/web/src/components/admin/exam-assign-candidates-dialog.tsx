'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { batchesApi, examsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { GraduationCap, Loader2 } from 'lucide-react';

interface ExamAssignCandidatesDialogProps {
  accessToken: string;
  examId: string;
  examTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BatchStudent = {
  candidateId: string;
  rollNumber?: string | null;
  firstName: string;
  lastName: string;
  registrationNumber: string;
};

export function ExamAssignCandidatesDialog({
  accessToken, examId, examTitle, open, onOpenChange,
}: ExamAssignCandidatesDialogProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => examsApi.get(accessToken, examId),
    enabled: open && !!accessToken,
  });

  const linkedBatch = exam?.aiTestConfig?.batch ?? null;
  const batchId = linkedBatch?.id;

  const { data: batchDetail, isLoading: batchLoading } = useQuery({
    queryKey: ['batch-detail', batchId],
    queryFn: () => batchesApi.get(accessToken, batchId!) as Promise<{
      enrollments: {
        rollNumber?: string | null;
        candidate: {
          id: string;
          registrationNumber: string;
          user: { firstName: string; lastName: string };
        };
      }[];
    }>,
    enabled: open && !!accessToken && !!batchId,
  });

  const batchStudents = useMemo<BatchStudent[]>(() => {
    if (!batchDetail?.enrollments) return [];
    return batchDetail.enrollments.map((e) => ({
      candidateId: e.candidate.id,
      rollNumber: e.rollNumber,
      firstName: e.candidate.user.firstName,
      lastName: e.candidate.user.lastName,
      registrationNumber: e.candidate.registrationNumber,
    }));
  }, [batchDetail]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    if (!batchStudents.length) return;
    const onExam = new Set((exam?.registrations ?? []).map((r: { candidateId: string }) => r.candidateId));
    setSelected(new Set(
      batchStudents.filter((s) => onExam.has(s.candidateId)).map((s) => s.candidateId),
    ));
  }, [open, batchStudents, exam?.registrations]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(batchStudents.map((s) => s.candidateId)));
  const selectNone = () => setSelected(new Set());

  const saveMutation = useMutation({
    mutationFn: () => examsApi.syncCandidates(accessToken, examId, [...selected]),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      const parts: string[] = [];
      if (data.added) parts.push(`${data.added} added`);
      if (data.removed) parts.push(`${data.removed} removed`);
      toast({
        title: 'Students updated',
        description: parts.length ? parts.join(', ') : `${data.assigned ?? selected.size} on this exam`,
        variant: 'success',
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Could not update students', description: e.message, variant: 'destructive' }),
  });

  const loading = examLoading || (!!batchId && batchLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Exam students</DialogTitle>
          <DialogDescription>
            Checked students will take <span className="font-medium text-foreground">{examTitle}</span>.
            Uncheck to exclude someone from this exam.
          </DialogDescription>
        </DialogHeader>

        {linkedBatch && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 normal-case tracking-normal">
              <GraduationCap className="h-3.5 w-3.5" />
              {linkedBatch.academicClass.name} · {linkedBatch.name}
            </Badge>
            <Badge variant="outline" className="normal-case tracking-normal">
              {linkedBatch.academicYear}
            </Badge>
          </div>
        )}

        {batchStudents.length > 0 && (
          <div className="flex gap-2 text-xs">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={selectAll}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={selectNone}>
              Select none
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading students…
            </div>
          )}
          {!loading && !linkedBatch && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              This exam is not linked to a batch. Create tests from Create Test to auto-link a batch.
            </p>
          )}
          {!loading && linkedBatch && !batchStudents.length && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No students in {linkedBatch.name}. Enroll students on Classes &amp; Batches first.
            </p>
          )}
          {!loading && batchStudents.map((s) => (
            <label
              key={s.candidateId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                checked={selected.has(s.candidateId)}
                onChange={() => toggle(s.candidateId)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.firstName} {s.lastName}</p>
                <p className="text-xs text-muted-foreground">
                  {s.registrationNumber}
                  {s.rollNumber ? ` · Roll ${s.rollNumber}` : ''}
                </p>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!linkedBatch || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : `Save (${selected.size} student${selected.size === 1 ? '' : 's'})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
