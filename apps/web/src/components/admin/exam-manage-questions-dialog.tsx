'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { examsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Loader2, Trash2 } from 'lucide-react';

interface ExamManageQuestionsDialogProps {
  accessToken: string;
  examId: string;
  examTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExamManageQuestionsDialog({
  accessToken, examId, examTitle, open, onOpenChange,
}: ExamManageQuestionsDialogProps) {
  const queryClient = useQueryClient();

  const { data: exam, isLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => examsApi.get(accessToken, examId),
    enabled: open && !!accessToken,
  });

  const linked: {
    questionId: string;
    title: string;
    type: string;
    status: string;
  }[] = (exam?.sections || []).flatMap(
    (s) =>
      (s.questions || []).map((q) => ({
        questionId: q.questionId,
        title: q.question?.title?.trim()
          || q.question?.versions?.[0]?.content?.text
          || 'Untitled question',
        type: q.question?.type ?? '',
        status: q.question?.status ?? '',
      })),
  );

  const removeMutation = useMutation({
    mutationFn: (questionId: string) => examsApi.removeQuestion(accessToken, examId, questionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      toast({ title: 'Question removed from exam', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Cannot remove', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Exam Questions</DialogTitle>
          <DialogDescription>
            Questions on <span className="font-medium text-foreground">{examTitle}</span>.
            Removing only unlinks from this exam — the question stays in the bank.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
            </div>
          )}
          {!isLoading && !linked.length && (
            <p className="text-sm text-muted-foreground py-4 text-center">No questions on this exam yet.</p>
          )}
          {!isLoading && linked.map((q) => (
            <div key={q.questionId} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug line-clamp-2">{q.title}</p>
                <div className="mt-1 flex gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{q.type}</Badge>
                  <Badge variant={q.status === 'APPROVED' ? 'success' : 'warning'} className="text-[10px]">{q.status}</Badge>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive hover:text-destructive"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (window.confirm('Remove this question from the exam?')) {
                    removeMutation.mutate(q.questionId);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
