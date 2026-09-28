'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { aiApi, examsApi, questionsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, Edit3, ExternalLink, Loader2, Sparkles, Trash2 } from 'lucide-react';
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
  referenceAnswer: string;
  rubric: string;
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
  referenceAnswer: string;
  rubric: string;
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

function normalizeOptionText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeApiChoiceOptions(raw: Record<string, string> | undefined) {
  if (!raw) return null;
  const pick = (labels: string[]) => {
    for (const label of labels) {
      const value = raw[label];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const normalized = {
    a: pick(['a', 'A', '1']),
    b: pick(['b', 'B', '2']),
    c: pick(['c', 'C', '3']),
    d: pick(['d', 'D', '4']),
  };
  return normalized.a && normalized.b && normalized.c && normalized.d ? normalized : null;
}

function isChoiceQuestion(type: string) {
  const normalized = type.trim().toUpperCase();
  return normalized === 'MCQ' || normalized === 'MSQ';
}

function choiceOptionsUnchanged(
  previous: { a: string; b: string; c: string; d: string },
  next: { a: string; b: string; c: string; d: string },
) {
  return (
    normalizeOptionText(previous.a) === normalizeOptionText(next.a)
    && normalizeOptionText(previous.b) === normalizeOptionText(next.b)
    && normalizeOptionText(previous.c) === normalizeOptionText(next.c)
    && normalizeOptionText(previous.d) === normalizeOptionText(next.d)
  );
}

function extractChoicePayload(data: {
  options?: Record<string, string>;
  correctAnswer?: { value?: string | string[] };
}) {
  const options = normalizeApiChoiceOptions(data.options);
  if (!options) return null;
  return {
    options,
    correctKey: resolveCorrectAnswerKey(data.correctAnswer),
  };
}

function isPlaceholderReferenceAnswer(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.startsWith('a correct answer accurately explains')
    || normalized.startsWith('a correct answer identifies and accurately explains');
}

function resolveReferenceAnswer(correct: unknown): { answer: string; rubric: string } {
  if (!correct || typeof correct !== 'object') return { answer: '', rubric: '' };
  const value = (correct as { value?: unknown; rubric?: unknown }).value;
  const rubric = (correct as { rubric?: unknown }).rubric;
  return {
    answer: typeof value === 'string' ? value : '',
    rubric: typeof rubric === 'string' ? rubric : '',
  };
}

const QUESTION_TYPE_ORDER = ['MCQ', 'MSQ', 'SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO'];

const QUESTION_TYPE_COPY: Record<string, { one: string; many: string }> = {
  MCQ: { one: 'MCQ', many: 'MCQs' },
  MSQ: { one: 'MSQ', many: 'MSQs' },
  SUBJECTIVE: { one: 'Subjective', many: 'Subjective' },
  CASE_STUDY: { one: 'Case study', many: 'Case studies' },
  CODING: { one: 'Coding', many: 'Coding' },
};

type MarkSchemeGroup = {
  type: string;
  label: string;
  count: number;
  marks: number | null;
  negativeMarks: number | null;
  subtotal: number;
};

type SchemeDraft = Record<string, { marks: string; negativeMarks: string }>;

function questionTypeLabel(type: string, count: number) {
  const copy = QUESTION_TYPE_COPY[type];
  if (!copy) return type;
  return count === 1 ? copy.one : copy.many;
}

function formatMarkValue(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function parseMarkInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function buildMarkScheme(rows: ExamQuestionRow[]): MarkSchemeGroup[] {
  const byType = new Map<string, ExamQuestionRow[]>();
  for (const row of rows) {
    const type = row.type.trim().toUpperCase();
    const list = byType.get(type) ?? [];
    list.push(row);
    byType.set(type, list);
  }

  return [...byType.keys()]
    .sort((a, b) => {
      const aIndex = QUESTION_TYPE_ORDER.indexOf(a);
      const bIndex = QUESTION_TYPE_ORDER.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .map((type) => {
      const groupRows = byType.get(type) ?? [];
      const markValues = groupRows.map((row) => row.marks);
      const negativeValues = groupRows.map((row) => row.negativeMarks);
      const marks = markValues.every((value) => value === markValues[0]) ? (markValues[0] ?? 0) : null;
      const negativeMarks = negativeValues.every((value) => value === negativeValues[0])
        ? (negativeValues[0] ?? 0)
        : null;
      return {
        type,
        label: questionTypeLabel(type, groupRows.length),
        count: groupRows.length,
        marks,
        negativeMarks,
        subtotal: groupRows.reduce((sum, row) => sum + row.marks, 0),
      };
    });
}

function schemeFromGroups(groups: MarkSchemeGroup[]): SchemeDraft {
  return Object.fromEntries(
    groups.map((group) => [
      group.type,
      {
        marks: group.marks == null ? '' : formatMarkValue(group.marks),
        negativeMarks: group.negativeMarks == null ? '' : formatMarkValue(group.negativeMarks),
      },
    ]),
  );
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
    referenceAnswer: row.referenceAnswer,
    rubric: row.rubric,
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
  const [scheme, setScheme] = useState<SchemeDraft>({});

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
          referenceAnswer: resolveReferenceAnswer(version?.correctAnswer).answer,
          rubric: resolveReferenceAnswer(version?.correctAnswer).rubric,
          marks: link.marks ?? version?.marks ?? 2,
          negativeMarks: link.negativeMarks ?? version?.negativeMarks ?? 0,
        });
      }
    }
    return list;
  }, [exam]);

  const markGroups = useMemo(() => buildMarkScheme(rows), [rows]);
  const savedSchemeKey = useMemo(
    () => rows.map((row) => `${row.questionId}:${row.type}:${row.marks}:${row.negativeMarks}`).join('|'),
    [rows],
  );

  useEffect(() => {
    setScheme(schemeFromGroups(markGroups));
  }, [savedSchemeKey, markGroups]);

  const schemePreview = useMemo(() => markGroups.map((group) => {
    const draft = scheme[group.type];
    const marks = draft ? parseMarkInput(draft.marks) : group.marks;
    const negativeMarks = draft ? parseMarkInput(draft.negativeMarks) : group.negativeMarks;
    const marksDirty = marks != null && group.marks !== marks;
    const negativeDirty = negativeMarks != null && group.negativeMarks !== negativeMarks;
    return {
      ...group,
      draftMarks: marks,
      draftNegative: negativeMarks,
      previewSubtotal: marks == null ? group.subtotal : marks * group.count,
      dirty: marksDirty || negativeDirty,
    };
  }), [markGroups, scheme]);

  const totalMarks = schemePreview.reduce((sum, group) => sum + group.previewSubtotal, 0);
  const schemeDirty = schemePreview.some((group) => group.dirty);
  const schemeInvalid = schemePreview.some(
    (group) => group.dirty && (group.draftMarks == null || group.draftNegative == null),
  );

  const saveMarksMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<unknown>[] = [];
      for (const group of schemePreview) {
        if (!group.dirty) continue;
        if (group.draftMarks == null || group.draftNegative == null) {
          throw new Error(`Enter marks and negative marks for ${group.label}`);
        }
        for (const row of rows) {
          if (row.type.trim().toUpperCase() !== group.type) continue;
          if (row.marks === group.draftMarks && row.negativeMarks === group.draftNegative) continue;
          updates.push(questionsApi.update(accessToken, row.questionId, {
            marks: group.draftMarks,
            negativeMarks: group.draftNegative,
          }));
        }
      }
      if (!updates.length) return;
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      toast({ title: 'Marking scheme updated', variant: 'success' });
    },
    onError: (e: Error) => toast({
      title: 'Could not update marks',
      description: e.message,
      variant: 'destructive',
    }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing || !form) throw new Error('Nothing to save');
      if (!form.content.trim()) throw new Error('Question text is required');
      const isOpenEnded = editing.type === 'SUBJECTIVE' || editing.type === 'CASE_STUDY';
      if (isOpenEnded && !form.referenceAnswer.trim()) throw new Error('Reference answer is required');
      if (!isOpenEnded && !form.correctAnswer) throw new Error('Select the correct answer');
      return questionsApi.update(accessToken, editing.questionId, {
        title: form.title.trim() || form.content.trim().slice(0, 80),
        content: { text: form.content.trim() },
        options: isOpenEnded ? {} : {
          a: form.optionA,
          b: form.optionB,
          c: form.optionC,
          d: form.optionD,
        },
        correctAnswer: isOpenEnded
          ? { value: form.referenceAnswer.trim(), rubric: form.rubric.trim() }
          : { value: form.correctAnswer },
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

  const generateAnswersMutation = useMutation({
    mutationFn: async (row: ExamQuestionRow) => {
      if (!form) throw new Error('Open the editor first');
      const questionText = form.content.trim() || row.content.trim();
      if (!questionText) throw new Error('Question text is required');
      const chapterTitle = row.title.includes(':')
        ? row.title.split(':').slice(1).join(':').replace(/\s*-?\s*Q\d+$/i, '').trim()
        : undefined;
      const subjectName = row.title.includes(':') ? row.title.split(':')[0]?.trim() : undefined;
      const isOpenEnded = row.type === 'SUBJECTIVE' || row.type === 'CASE_STUDY';
      const previousChoiceOptions = isChoiceQuestion(row.type)
        ? {
          a: form.optionA,
          b: form.optionB,
          c: form.optionC,
          d: form.optionD,
        }
        : null;
      const data = await aiApi.generateReferenceAnswer(accessToken, {
        questionText,
        questionType: row.type,
        subjectName,
        chapterTitle,
        regenerate: true,
        options: isOpenEnded ? undefined : previousChoiceOptions ?? undefined,
      });
      return {
        data,
        row,
        previousChoiceOptions,
        previousCorrectAnswer: form.correctAnswer,
      };
    },
    onSuccess: ({ data, row, previousChoiceOptions, previousCorrectAnswer }) => {
      const isOpenEnded = row.type === 'SUBJECTIVE' || row.type === 'CASE_STUDY';

      if (isOpenEnded) {
        if (!data.referenceAnswer?.trim()) {
          toast({
            title: 'No changes applied',
            description: 'The AI response did not include a reference answer. Try again.',
            variant: 'destructive',
          });
          return;
        }
        setForm((current) => (
          current
            ? {
              ...current,
              referenceAnswer: data.referenceAnswer ?? current.referenceAnswer,
              rubric: data.rubric ?? current.rubric,
            }
            : current
        ));
        toast({ title: 'AI answers generated', variant: 'success' });
        return;
      }

      const payload = extractChoicePayload(data);
      if (!payload) {
        toast({
          title: 'No changes applied',
          description: 'The AI response did not include four valid options (a–d). Try again.',
          variant: 'destructive',
        });
        return;
      }

      const answerChanged = Boolean(
        payload.correctKey && payload.correctKey !== previousCorrectAnswer,
      );
      if (
        previousChoiceOptions
        && choiceOptionsUnchanged(previousChoiceOptions, payload.options)
        && !answerChanged
      ) {
        toast({
          title: 'Options unchanged',
          description: 'The AI returned the same option text. Try again or tweak the question.',
          variant: 'destructive',
        });
        return;
      }

      setForm((current) => (
        current
          ? {
            ...current,
            optionA: payload.options.a,
            optionB: payload.options.b,
            optionC: payload.options.c,
            optionD: payload.options.d,
            correctAnswer: payload.correctKey || current.correctAnswer,
          }
          : current
      ));
      toast({ title: 'AI answers generated', variant: 'success' });
    },
    onError: (e: Error) => toast({
      title: 'Could not generate answers',
      description: e.message,
      variant: 'destructive',
    }),
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

  const marksForRow = (row: ExamQuestionRow) => {
    const draft = scheme[row.type.trim().toUpperCase()];
    const marks = draft ? parseMarkInput(draft.marks) : null;
    const negativeMarks = draft ? parseMarkInput(draft.negativeMarks) : null;
    return {
      marks: marks ?? row.marks,
      negativeMarks: negativeMarks ?? row.negativeMarks,
      pending: (marks != null && marks !== row.marks)
        || (negativeMarks != null && negativeMarks !== row.negativeMarks),
    };
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
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg">Generated questions</CardTitle>
            {!isLoading && rows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Change marks by question type. Saving applies the new value to every question of that type.
              </p>
            )}
          </div>
          {!isLoading && rows.length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-4 py-2 text-right">
              <p className="text-xs text-muted-foreground">Total marks</p>
              <p className="text-2xl font-semibold leading-none">{formatMarkValue(totalMarks)}</p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!isLoading && rows.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              {schemePreview.map((group) => {
                const draft = scheme[group.type] ?? {
                  marks: group.marks == null ? '' : formatMarkValue(group.marks),
                  negativeMarks: group.negativeMarks == null ? '' : formatMarkValue(group.negativeMarks),
                };
                const marksLabel = group.draftMarks == null
                  ? 'marks vary'
                  : `${formatMarkValue(group.draftMarks)} mark${group.draftMarks === 1 ? '' : 's'} each`;
                return (
                  <div
                    key={group.type}
                    className="flex flex-col gap-3 border-b border-border/60 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-end sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {group.label}
                        <span className="font-normal text-muted-foreground"> — {marksLabel}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.count} question{group.count === 1 ? '' : 's'}
                        {' · '}
                        {formatMarkValue(group.previewSubtotal)} mark{group.previewSubtotal === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-28">
                        <Label htmlFor={`marks-${group.type}`} className="text-xs">Marks each</Label>
                        <Input
                          id={`marks-${group.type}`}
                          type="number"
                          min={0}
                          step={0.5}
                          placeholder={group.marks == null ? 'Mixed' : undefined}
                          className="mt-1 h-9"
                          value={draft.marks}
                          disabled={saveMarksMutation.isPending}
                          onChange={(e) => setScheme((current) => ({
                            ...current,
                            [group.type]: { ...draft, marks: e.target.value },
                          }))}
                        />
                      </div>
                      <div className="w-28">
                        <Label htmlFor={`negative-${group.type}`} className="text-xs">Negative each</Label>
                        <Input
                          id={`negative-${group.type}`}
                          type="number"
                          min={0}
                          step={0.25}
                          placeholder={group.negativeMarks == null ? 'Mixed' : undefined}
                          className="mt-1 h-9"
                          value={draft.negativeMarks}
                          disabled={saveMarksMutation.isPending}
                          onChange={(e) => setScheme((current) => ({
                            ...current,
                            [group.type]: { ...draft, negativeMarks: e.target.value },
                          }))}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-sm text-muted-foreground">
                  {schemeDirty ? 'Unsaved mark changes' : 'Marking scheme matches the questions below'}
                </p>
                <Button
                  size="sm"
                  disabled={!schemeDirty || schemeInvalid || saveMarksMutation.isPending}
                  onClick={() => saveMarksMutation.mutate()}
                >
                  {saveMarksMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save marks'
                  )}
                </Button>
              </div>
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading questions…
            </div>
          )}
          {!isLoading && !rows.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">No questions found on this exam.</p>
          )}
          {!isLoading && rows.map((row, index) => {
            const shownMarks = marksForRow(row);
            return (
            <div key={row.questionId} className="rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                  {row.type === 'SUBJECTIVE' || row.type === 'CASE_STUDY' ? (
                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">Reference answer</p>
                        {isPlaceholderReferenceAnswer(row.referenceAnswer) && (
                          <Badge variant="secondary">Template — regenerate with AI</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-muted-foreground">{row.referenceAnswer}</p>
                      {row.rubric && <p className="mt-2 text-xs text-muted-foreground">Rubric: {row.rubric}</p>}
                    </div>
                  ) : (
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
                  )}
                  <p className="text-xs text-muted-foreground">
                    Marks: {formatMarkValue(shownMarks.marks)}
                    {' · '}
                    Negative: {formatMarkValue(shownMarks.negativeMarks)}
                    {shownMarks.pending ? ' · unsaved' : ''}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row">
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
            );
          })}
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
              {editing?.type === 'SUBJECTIVE' || editing?.type === 'CASE_STUDY' ? (
                <>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label>Reference answer</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={generateAnswersMutation.isPending}
                        onClick={() => editing && generateAnswersMutation.mutate(editing)}
                      >
                        {generateAnswersMutation.isPending ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1.5 h-4 w-4" />
                        )}
                        Generate with AI
                      </Button>
                    </div>
                    <Textarea
                      rows={4}
                      value={form.referenceAnswer}
                      onChange={(e) => setForm({ ...form, referenceAnswer: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Rubric</Label>
                    <Textarea
                      rows={3}
                      value={form.rubric}
                      onChange={(e) => setForm({ ...form, rubric: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={generateAnswersMutation.isPending}
                      onClick={() => editing && generateAnswersMutation.mutate(editing)}
                    >
                      {generateAnswersMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1.5 h-4 w-4" />
                      )}
                      Regenerate options &amp; key with AI
                    </Button>
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
                </>
              )}
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
