'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { examsApi, questionsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, Edit3, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';

type ExamQuestionRow = {
  questionId: string;
  sectionName: string;
  orderIndex: number;
  title: string;
  type: string;
  status: string;
  content: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  marks: number;
  negativeMarks: number;
};

type EditForm = {
  title: string;
  content: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  marks: number;
  negativeMarks: number;
};

interface AiTestQuestionsReviewProps {
  accessToken: string;
  examId: string;
  examTitle: string;
  questionCount?: number;
  onCreateAnother: () => void;
}

function resolveCorrectAnswerKey(correct: unknown): string {
  if (!correct) return '';
  const raw = typeof correct === 'object' && correct !== null && 'value' in correct
    ? (correct as { value: unknown }).value
    : correct;
  const key = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  const lowered = key.trim().toLowerCase();
  return ['a', 'b', 'c', 'd'].includes(lowered) ? lowered : '';
}

function toEditForm(row: ExamQuestionRow): EditForm {
  return {
    title: row.title,
    content: row.content,
    optionA: row.optionA,
    optionB: row.optionB,
    optionC: row.optionC,
    optionD: row.optionD,
    correctAnswer: row.correctAnswer,
    marks: row.marks,
    negativeMarks: row.negativeMarks,
  };
}

export function AiTestQuestionsReview({
  accessToken,
  examId,
  examTitle,
  questionCount,
  onCreateAnother,
}: AiTestQuestionsReviewProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ExamQuestionRow | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [deleting, setDeleting] = useState<ExamQuestionRow | null>(null);

  const { data: exam, isLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => examsApi.get(accessToken, examId),
    enabled: !!accessToken && !!examId,
  });

  const rows = useMemo<ExamQuestionRow[]>(() => {
    if (!exam?.sections) return [];
    const list: ExamQuestionRow[] = [];
    for (const section of exam.sections) {
      for (const link of section.questions ?? []) {
        const version = link.question?.versions?.[0];
        const options = (version?.options ?? {}) as Record<string, string>;
        list.push({
          questionId: link.questionId,
          sectionName: section.name ?? 'Section',
          orderIndex: list.length,
          title: link.question?.title?.trim() || version?.content?.text?.trim() || 'Untitled question',
          type: link.question?.type ?? 'MCQ',
          status: link.question?.status ?? 'DRAFT',
          content: version?.content?.text?.trim() || link.question?.title?.trim() || '',
          optionA: options.a ?? options.A ?? '',
          optionB: options.b ?? options.B ?? '',
          optionC: options.c ?? options.C ?? '',
          optionD: options.d ?? options.D ?? '',
          correctAnswer: resolveCorrectAnswerKey(version?.correctAnswer),
          marks: version?.marks ?? 2,
          negativeMarks: version?.negativeMarks ?? 0,
        });
      }
    }
    return list;
  }, [exam]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing || !form) throw new Error('Nothing to save');
      if (!form.content.trim()) throw new Error('Question text is required');
      if (!form.correctAnswer) throw new Error('Select the correct answer');
      return questionsApi.update(accessToken, editing.questionId, {
        title: form.title.trim() || form.content.trim().slice(0, 80),
        content: { text: form.content.trim() },
        options: {
          a: form.optionA,
          b: form.optionB,
          c: form.optionC,
          d: form.optionD,
        },
        correctAnswer: { value: form.correctAnswer },
        marks: form.marks,
        negativeMarks: form.negativeMarks,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      toast({ title: 'Question updated', variant: 'success' });
      setEditing(null);
      setForm(null);
    },
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (questionId: string) => examsApi.removeQuestion(accessToken, examId, questionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      toast({ title: 'Question removed', variant: 'success' });
      setDeleting(null);
      if (editing && deleting && editing.questionId === deleting.questionId) {
        setEditing(null);
        setForm(null);
      }
    },
    onError: (e: Error) => toast({ title: 'Could not remove question', description: e.message, variant: 'destructive' }),
  });

  const openEdit = (row: ExamQuestionRow) => {
    setEditing(row);
    setForm(toEditForm(row));
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">Draft exam created</p>
              <p className="text-sm text-muted-foreground">
                {examTitle} — {isLoading ? (questionCount ?? '…') : rows.length} AI-generated
                question{!isLoading && rows.length === 1 ? '' : 's'}.
                Review, edit, or remove below, then publish from Class Tests.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onCreateAnother}>Create another</Button>
            <Button asChild>
              <Link href="/dashboard/exams">
                <ExternalLink className="mr-2 h-4 w-4" />
                Go to Exams
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generated questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading questions…
            </div>
          )}
          {!isLoading && !rows.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">No questions found on this exam.</p>
          )}
          {!isLoading && rows.map((row, index) => (
            <div key={row.questionId} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Q{index + 1}</span>
                    {exam?.sections && exam.sections.length > 1 && (
                      <Badge variant="secondary" className="text-[10px]">{row.sectionName}</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{row.type}</Badge>
                    <Badge variant="warning" className="text-[10px]">{row.status}</Badge>
                  </div>
                  <p className="font-medium leading-snug">{row.content || row.title}</p>
                  <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                    {(['a', 'b', 'c', 'd'] as const).map((key) => {
                      const label = key.toUpperCase();
                      const text = row[`option${label}` as keyof Pick<ExamQuestionRow, 'optionA' | 'optionB' | 'optionC' | 'optionD'>];
                      const isCorrect = row.correctAnswer === key;
                      return (
                        <p key={key} className={isCorrect ? 'font-medium text-foreground' : undefined}>
                          {label}. {text}
                          {isCorrect ? ' ✓' : ''}
                        </p>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Marks: {row.marks} · Negative: {row.negativeMarks}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                    <Edit3 className="mr-1.5 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleting(row)}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setForm(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit question</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Title (optional)</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label>Question text</Label>
                <Textarea
                  rows={4}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
              </div>
              {(['A', 'B', 'C', 'D'] as const).map((label) => {
                const key = `option${label}` as keyof EditForm;
                return (
                  <div key={label}>
                    <Label>Option {label}</Label>
                    <Input
                      value={String(form[key])}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </div>
                );
              })}
              <div>
                <Label>Correct answer</Label>
                <select
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.correctAnswer}
                  onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                >
                  <option value="" disabled>Select correct answer</option>
                  <option value="a">A</option>
                  <option value="b">B</option>
                  <option value="c">C</option>
                  <option value="d">D</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Marks</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={form.marks}
                    onChange={(e) => setForm({ ...form, marks: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>Negative marks</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.25}
                    value={form.negativeMarks}
                    onChange={(e) => setForm({ ...form, negativeMarks: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleteMutation.isPending || !editing}
              onClick={() => editing && setDeleting(editing)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setEditing(null); setForm(null); }}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove question?</DialogTitle>
            <DialogDescription>
              This removes the question from this draft test. You can keep editing the rest before publishing.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-snug">
              {deleting.content || deleting.title}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deleteMutation.isPending} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !deleting}
              onClick={() => deleting && deleteMutation.mutate(deleting.questionId)}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove question
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
