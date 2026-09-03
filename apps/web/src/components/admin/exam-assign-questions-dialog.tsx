'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { examsApi, questionsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Loader2, Search } from 'lucide-react';

interface BankQuestion {
  id: string;
  title: string | null;
  type: string;
  difficulty: string;
  status: string;
  versions?: { content?: { text?: string } }[];
}

interface ExamAssignQuestionsDialogProps {
  accessToken: string;
  examId: string;
  sectionId: string;
  examTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function questionLabel(q: BankQuestion) {
  const text = q.versions?.[0]?.content?.text;
  return q.title?.trim() || (typeof text === 'string' ? text : '') || 'Untitled question';
}

export function ExamAssignQuestionsDialog({
  accessToken, examId, sectionId, examTitle, open, onOpenChange,
}: ExamAssignQuestionsDialogProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => examsApi.get(accessToken, examId),
    enabled: open && !!accessToken,
  });

  const { data: questions, isLoading: questionsLoading, error: questionsError } = useQuery({
    queryKey: ['questions', 'exam-picker', search],
    queryFn: () => questionsApi.list(accessToken, 1, { search: search || undefined, limit: 100 }),
    enabled: open && !!accessToken,
  });

  const linkedIds = useMemo(() => {
    const section = exam?.sections?.find((s: { id: string }) => s.id === sectionId);
    return new Set((section?.questions || []).map((q: { questionId: string }) => q.questionId));
  }, [exam, sectionId]);

  const bankItems = (questions?.items || []) as BankQuestion[];

  const available = useMemo(
    () => bankItems.filter((q) => !linkedIds.has(q.id)),
    [bankItems, linkedIds],
  );

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch('');
    }
  }, [open]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      examsApi.addQuestions(accessToken, examId, sectionId, [...selected]),
    onSuccess: (data: { added?: number; skipped?: number }) => {
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      const added = data.added ?? 0;
      const skipped = data.skipped ?? 0;
      if (added > 0) {
        toast({
          title: `${added} question${added === 1 ? '' : 's'} added`,
          description: skipped > 0 ? `${skipped} already on this exam` : undefined,
          variant: 'success',
        });
      } else {
        toast({ title: 'No new questions added', description: 'Selected questions are already on this exam', variant: 'destructive' });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Failed to add questions', description: e.message, variant: 'destructive' }),
  });

  const loading = examLoading || questionsLoading;
  const draftCount = available.filter((q) => q.status === 'DRAFT').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Questions from Bank</DialogTitle>
          <DialogDescription>
            Select questions for <span className="font-medium text-foreground">{examTitle}</span>.
            {linkedIds.size > 0 && ` ${linkedIds.size} already on this exam.`}
            {draftCount > 0 && ' Draft questions are auto-approved when added.'}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search question bank..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading question bank...
            </div>
          )}
          {questionsError && (
            <p className="text-sm text-destructive py-4 text-center">
              Failed to load questions: {(questionsError as Error).message}
            </p>
          )}
          {!loading && !questionsError && !available.length && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {bankItems.length === 0
                ? 'No questions in the bank yet. Add questions on the Questions page or generate them in AI Studio.'
                : 'All questions from the bank are already on this exam.'}
            </p>
          )}
          {!loading && available.map((q) => (
            <label
              key={q.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(q.id)}
                onChange={() => toggle(q.id)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug line-clamp-2">{questionLabel(q)}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{q.type}</Badge>
                  <Badge variant="outline" className="text-[10px]">{q.difficulty}</Badge>
                  <Badge variant={q.status === 'APPROVED' ? 'success' : 'warning'} className="text-[10px]">
                    {q.status}
                  </Badge>
                </div>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!selected.size || addMutation.isPending}
          >
            {addMutation.isPending ? 'Adding...' : `Add ${selected.size || ''} question${selected.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
