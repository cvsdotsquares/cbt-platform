'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { resultsApi, type ResultReviewQuestion } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';

type AnswerReviewDialogProps = {
  open: boolean;
  resultId: string | null;
  accessToken: string | null;
  onClose: () => void;
  /** When true, show candidate name in the header (staff view). */
  showCandidateName?: boolean;
  /** Label for the candidate's selection in option lists. */
  markedAnswerLabel?: string;
};

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
    return { label: 'Incorrect', variant: 'destructive', Icon: XCircle };
  }
  return { label: 'Graded', variant: 'warning', Icon: CircleHelp };
}

export function AnswerReviewDialog({
  open,
  resultId,
  accessToken,
  onClose,
  showCandidateName = false,
  markedAnswerLabel = 'your answer',
}: AnswerReviewDialogProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['result-review', resultId],
    queryFn: () => resultsApi.review(accessToken!, resultId!),
    enabled: open && !!accessToken && !!resultId,
  });

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
                    {data.totalScore}/{data.maxScore} ({data.percentage.toFixed(1)}%)
                  </>
                )
                : 'Compare marked answers with the correct answers.'}
            </DialogDescription>
          </DialogHeader>
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
                          {q.marksAwarded != null ? q.marksAwarded : '—'}/{q.maxMarks}
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

        <div className="border-t border-border/60 px-5 py-3 sm:px-6">
          <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
