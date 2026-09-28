'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { resultsApi, type ResultReviewQuestion } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CheckCircle2, CircleHelp, Loader2, Pencil, XCircle } from 'lucide-react';

const MANUAL_GRADE_TYPES = new Set([
  'SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO', 'MSQ',
]);

type AnswerReviewDialogProps = {
  open: boolean;
  resultId: string | null;
  accessToken: string | null;
  onClose: () => void;
  /** When true, show candidate name in the header (staff view). */
  showCandidateName?: boolean;
  /** Allow teachers to override auto-grades for open-ended questions. */
  manualGradingEnabled?: boolean;
  /** Label for the candidate's selection in option lists. */
  markedAnswerLabel?: string;
  /** Called after a manual grade updates totals (e.g. refresh results table). */
  onGraded?: () => void;
};

function formatMarksAwarded(q: ResultReviewQuestion): string {
  if (q.marksAwarded != null) {
    const n = q.marksAwarded;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  if (!q.answered) return '0';
  if (q.isCorrect === true) return String(q.maxMarks);
  if (q.isCorrect === false) return '0';
  return '—';
}

function statusFor(q: ResultReviewQuestion): {
  label: string;
  variant: 'success' | 'destructive' | 'secondary' | 'warning';
  Icon: typeof CheckCircle2;
} {
  if (!q.answered) {
    return { label: 'Unanswered', variant: 'secondary', Icon: CircleHelp };
  }
  if (q.isCorrect === true) {
    return { label: 'Correct', variant: 'success', Icon: CheckCircle2 };
  }
  if (q.isCorrect === false) {
    if (
      q.marksAwarded != null
      && q.marksAwarded > 0
      && q.marksAwarded < q.maxMarks
    ) {
      return { label: 'Partial credit', variant: 'warning', Icon: CircleHelp };
    }
    return { label: 'Incorrect', variant: 'destructive', Icon: XCircle };
  }
  if (
    q.marksAwarded != null
    && q.answered
    && q.isCorrect == null
    && q.marksAwarded > 0
  ) {
    return { label: 'Partial credit', variant: 'warning', Icon: CircleHelp };
  }
  return { label: 'Graded', variant: 'warning', Icon: CircleHelp };
}

function ManualGradePanel({
  question,
  sessionId,
  accessToken,
  onSaved,
}: {
  question: ResultReviewQuestion;
  sessionId: string;
  accessToken: string;
  onSaved: () => void;
}) {
  const initial = question.marksAwarded ?? (question.isCorrect ? question.maxMarks : 0);
  const [marksInput, setMarksInput] = useState(String(initial));

  const mutation = useMutation({
    mutationFn: (marks: number) =>
      resultsApi.grade(accessToken, sessionId, question.questionId, marks),
    onSuccess: () => {
      toast({ title: 'Marks updated', description: 'Score and result totals have been recalculated.' });
      onSaved();
    },
    onError: (e) => {
      toast({
        title: 'Could not save marks',
        description: e instanceof Error ? e.message : 'Try again',
        variant: 'destructive',
      });
    },
  });

  const applyMarks = (marks: number) => {
    const clamped = Math.min(question.maxMarks, Math.max(0, marks));
    setMarksInput(String(clamped));
    mutation.mutate(clamped);
  };

  const parseInput = (): number | null => {
    const n = Number.parseFloat(marksInput);
    if (!Number.isFinite(n)) return null;
    return Math.min(question.maxMarks, Math.max(0, n));
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Pencil className="h-3.5 w-3.5 text-primary" />
        Manual grading
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Override auto-grading for partial credit (e.g. MSQ with some correct options) or when open-ended keyword matching was too strict.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            max={question.maxMarks}
            step={0.5}
            className="h-9 w-24 tabular-nums"
            value={marksInput}
            onChange={(e) => setMarksInput(e.target.value)}
            disabled={mutation.isPending}
          />
          <span className="text-xs text-muted-foreground">/ {question.maxMarks}</span>
        </div>
        <Button
          size="sm"
          disabled={mutation.isPending || parseInput() == null}
          onClick={() => {
            const m = parseInput();
            if (m != null) applyMarks(m);
          }}
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save marks'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => applyMarks(question.maxMarks)}
        >
          Full marks
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => applyMarks(0)}
        >
          Zero
        </Button>
      </div>
    </div>
  );
}

export function AnswerReviewDialog({
  open,
  resultId,
  accessToken,
  onClose,
  showCandidateName = false,
  manualGradingEnabled = false,
  markedAnswerLabel = 'your answer',
  onGraded,
}: AnswerReviewDialogProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['result-review', resultId],
    queryFn: () => resultsApi.review(accessToken!, resultId!),
    enabled: open && !!accessToken && !!resultId,
  });

  const refreshReview = () => {
    if (resultId) {
      void queryClient.invalidateQueries({ queryKey: ['result-review', resultId] });
    }
    onGraded?.();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
        <div className="border-b border-border/60 px-5 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle>Answer review</DialogTitle>
            <DialogDescription>
              {data
                ? (
                  <>
                    {data.examTitle}
                    {showCandidateName ? ` · ${data.candidateName}` : ''}
                    {' · '}
                    {data.totalScore}/{data.maxScore} ({Number.isInteger(data.percentage) ? data.percentage : data.percentage.toFixed(1)}%)
                  </>
                )
                : 'Compare marked answers with the correct answers.'}
            </DialogDescription>
          </DialogHeader>
          {manualGradingEnabled && data?.sessionId && (
            <p className="mt-2 text-xs text-muted-foreground">
              MSQ and open-ended questions can be manually re-scored below; totals update immediately.
            </p>
          )}
        </div>

        <div className="max-h-[calc(85vh-8rem)] overflow-y-auto px-5 py-4 sm:px-6">
          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading answers…</p>
          )}
          {isError && (
            <p className="py-8 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load answer review'}
            </p>
          )}
          {data && (
            <ol className="space-y-4">
              {data.questions.map((q) => {
                const status = statusFor(q);
                const optionEntries = Object.entries(q.options);
                const canManualGrade =
                  manualGradingEnabled
                  && !!data.sessionId
                  && !!accessToken
                  && q.answered
                  && MANUAL_GRADE_TYPES.has((q.type || '').toUpperCase());

                return (
                  <li
                    key={q.questionId}
                    className="rounded-xl border border-border/60 bg-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Q{q.number}
                          {q.sectionName ? ` · ${q.sectionName}` : ''}
                          {' · '}
                          {q.type}
                        </p>
                        <p className="mt-1 text-sm font-medium leading-relaxed">{q.text}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={status.variant} className="gap-1">
                          <status.Icon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatMarksAwarded(q)}/{q.maxMarks}
                        </span>
                      </div>
                    </div>

                    {optionEntries.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {optionEntries.map(([key, label]) => {
                          const selected = q.candidateAnswer.map((a) => a.toLowerCase()).includes(key);
                          const correct = q.correctAnswer.map((a) => a.toLowerCase()).includes(key);
                          return (
                            <li
                              key={key}
                              className={cn(
                                'rounded-lg border px-3 py-2 text-sm',
                                correct && 'border-emerald-500/40 bg-emerald-500/10',
                                selected && !correct && 'border-red-500/40 bg-red-500/10',
                                !selected && !correct && 'border-transparent bg-muted/40',
                              )}
                            >
                              <span className="font-semibold uppercase">{key}.</span> {label}
                              {selected && (
                                <span className="ml-2 text-xs font-medium text-muted-foreground">
                                  ({markedAnswerLabel})
                                </span>
                              )}
                              {correct && (
                                <span className="ml-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                  (correct)
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {optionEntries.length === 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Marked answer</p>
                          <p className="mt-1 whitespace-pre-wrap">{q.candidateAnswerLabel}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
                          <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                            Correct answer
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{q.correctAnswerLabel}</p>
                        </div>
                      </div>
                    )}

                    {canManualGrade && (
                      <ManualGradePanel
                        key={`${q.questionId}-${formatMarksAwarded(q)}`}
                        question={q}
                        sessionId={data.sessionId!}
                        accessToken={accessToken!}
                        onSaved={refreshReview}
                      />
                    )}

                    {q.explanation && (
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">Explanation: </span>
                        {q.explanation}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
