'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { examSessionApi } from '@/lib/api';
import { useRequireCandidate } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { useExamSocket } from '@/hooks/use-exam-socket';
import { useExamSecurity } from '@/hooks/use-exam-security';
import { useCameraProctoring } from '@/hooks/use-camera-proctoring';
import { CameraPreview } from '@/components/proctoring/camera-preview';
import { QuestionInput } from '@/components/exam/question-input';
import type { ExamSecurityPolicy } from '@cbt/shared';
import { normalizeSecurityPolicy, exitDocumentFullscreen, isFullscreenActive } from '@/lib/exam-security-policy';
import { AlertTriangle, Shield, Wifi, WifiOff, Check, Loader2 } from 'lucide-react';

interface Question {
  id: string;
  type: string;
  title: string;
  content: { text?: string };
  options: Record<string, string>;
  marks: number;
}

export default function ExamStartPage() {
  const params = useParams();
  const examId = params.examId as string;
  const router = useRouter();
  const { accessToken, user, ready } = useRequireCandidate();
  const [session, setSession] = useState<{
    sessionId: string;
    questions: Question[];
    timeRemainingSeconds: number;
    riskScore: number;
    exam: { settings?: Record<string, unknown>; securityPolicy?: ExamSecurityPolicy };
    responses: { questionId: string; answer: unknown; markedForReview: boolean }[];
  } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [review, setReview] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [result, setResult] = useState<{ totalScore: number; maxScore: number; percentage: number } | null>(null);
  const [error, setError] = useState('');
  const [securityReady, setSecurityReady] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const answersRef = useRef<Record<string, string | string[]>>({});
  const reviewRef = useRef<Record<string, boolean>>({});
  const questionEnteredAt = useRef(Date.now());
  const submittingRef = useRef(false);

  const examSocket = useExamSocket(session?.sessionId ?? null, !!session && !done);

  const securityPolicy = normalizeSecurityPolicy(
    session?.exam?.securityPolicy as Partial<ExamSecurityPolicy> & { fullscreenRequired?: boolean },
  );
  const proctoringEnabled = securityPolicy.proctoringEnabled !== false;

  const camera = useCameraProctoring({
    sessionId: session?.sessionId ?? '',
    enabled: proctoringEnabled && !!session && !done,
  });

  const { violations, enterFullscreen, watermarkEnabled, isFullscreen } = useExamSecurity({
    sessionId: session?.sessionId ?? '',
    accessToken: accessToken ?? '',
    policy: securityPolicy,
    candidateLabel: `${user?.firstName} ${user?.lastName}`,
    enabled: !!session && !done,
  });

  const fullscreenRequired = securityPolicy.fullscreen !== false;

  useLayoutEffect(() => {
    if (!securityReady || !session || done || !fullscreenRequired) return;
    if (isFullscreenActive()) void enterFullscreen();
  }, [securityReady, session, done, fullscreenRequired, enterFullscreen]);

  useEffect(() => {
    if (!ready || !accessToken) return;
    examSessionApi.start(accessToken, examId)
      .then(async (data) => {
        const d = data as typeof session;
        setSession(d);
        setTimeLeft((data as { timeRemainingSeconds: number }).timeRemainingSeconds);
        const existing: Record<string, string | string[]> = {};
        const reviewState: Record<string, boolean> = {};
        ((data as { responses: { questionId: string; answer: { value?: string | string[] }; markedForReview: boolean }[] }).responses || []).forEach((r) => {
          if (r.markedForReview) reviewState[r.questionId] = true;
          if (r.answer) {
            const val = (r.answer as { value?: string | string[] }).value ?? r.answer;
            existing[r.questionId] = val as string | string[];
          }
        });
        answersRef.current = existing;
        reviewRef.current = reviewState;
        setAnswers(existing);
        setReview(reviewState);
        setSecurityReady(true);
      })
      .catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, examId, ready]);

  useEffect(() => {
    questionEnteredAt.current = Date.now();
  }, [currentIndex]);

  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  const getTimeSpentSeconds = () =>
    Math.max(1, Math.floor((Date.now() - questionEnteredAt.current) / 1000));

  const buildPendingAnswers = useCallback(() => (
    Object.entries(answersRef.current)
      .filter(([, value]) => {
        if (value == null || value === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
      })
      .map(([questionId, value]) => ({
        questionId,
        answer: { value },
        timeSpentSeconds: getTimeSpentSeconds(),
        markedForReview: reviewRef.current[questionId] || false,
      }))
  ), []);

  const persistAnswerNow = useCallback(async (
    questionId: string,
    value: string | string[],
  ) => {
    if (!session || !accessToken) return;
    const timeSpentSeconds = getTimeSpentSeconds();
    const payload = {
      sessionId: session.sessionId,
      questionId,
      answer: { value },
      timeSpentSeconds,
      markedForReview: reviewRef.current[questionId] || false,
    };
    try {
      if (examSocket.connected) {
        await examSocket.saveAnswer(payload);
      } else {
        await examSessionApi.saveAnswer(accessToken, session.sessionId, {
          questionId,
          answer: { value },
          timeSpentSeconds,
          markedForReview: reviewRef.current[questionId] || false,
        });
      }
      setSaveStatus('saved');
      if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      try {
        await examSessionApi.saveAnswer(accessToken, session.sessionId, {
          questionId,
          answer: { value },
          timeSpentSeconds,
          markedForReview: reviewRef.current[questionId] || false,
        });
        setSaveStatus('saved');
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
      }
    }
  }, [session, accessToken, examSocket]);

  const saveAnswer = useCallback((questionId: string, value: string | string[]) => {
    if (!session || !accessToken) return;
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
    setSaveStatus('saving');

    // Debounce network writes (esp. typed answers); submit/heartbeat always flush answersRef
    if (persistTimers.current[questionId]) clearTimeout(persistTimers.current[questionId]);
    persistTimers.current[questionId] = setTimeout(() => {
      void persistAnswerNow(questionId, value);
    }, 350);
  }, [session, accessToken, persistAnswerNow]);

  const finishExam = useCallback((result: { totalScore: number; maxScore: number; percentage: number }) => {
    setResult(result);
    setDone(true);
    if (isFullscreenActive()) void exitDocumentFullscreen();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!session || !accessToken || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setShowSubmitDialog(false);

    // Flush any debounced per-question timers before final submit
    Object.values(persistTimers.current).forEach((t) => clearTimeout(t));
    persistTimers.current = {};

    const answers = buildPendingAnswers();
    try {
      const res = await examSessionApi.submit(accessToken, session.sessionId, { answers }) as {
        result: { totalScore: number; maxScore: number; percentage: number };
      };
      finishExam(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [session, accessToken, finishExam, buildPendingAnswers]);

  useEffect(() => {
    if (!session || done) return;
    const interval = setInterval(async () => {
      if (!accessToken || submittingRef.current) return;
      const answers = buildPendingAnswers();
      try {
        const hb = examSocket.connected
          ? await examSocket.heartbeat(session.sessionId, answers)
          : await examSessionApi.heartbeat(accessToken, session.sessionId, { answers }) as {
              timeRemainingSeconds: number;
              autoSubmitted: boolean;
              result?: { totalScore: number; maxScore: number; percentage: number };
            };
        setTimeLeft(hb.timeRemainingSeconds);
        if (hb.autoSubmitted && hb.result) {
          submittingRef.current = true;
          finishExam(hb.result);
        }
      } catch {
        /* heartbeat retry on next interval */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [session, accessToken, done, finishExam, examSocket, buildPendingAnswers]);

  useEffect(() => {
    if (done || !session) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [session, done]);

  useEffect(() => {
    if (done || !session || !accessToken || timeLeft > 0 || submittingRef.current) return;
    void handleSubmit();
  }, [timeLeft, done, session, accessToken, handleSubmit]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  if (error) return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="p-6"><p className="text-destructive">{error}</p><Button className="mt-4" onClick={() => router.push('/my-exams')}>Back</Button></Card>
    </div>
  );
  if (!session || !securityReady) return <div className="flex min-h-screen items-center justify-center">Initializing secure exam environment...</div>;

  if (fullscreenRequired && !isFullscreen) {
    return (
      <div className="exam-shell-fullscreen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-5 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Fullscreen Required</h2>
              <p className="text-sm text-muted-foreground">
                Click below to enter secure fullscreen mode. Your browser will hide tabs and the address bar during the test.
              </p>
            </div>
            {fullscreenError && (
              <p className="text-sm text-destructive">{fullscreenError}</p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                onClick={async () => {
                  setFullscreenError('');
                  const ok = await enterFullscreen();
                  if (!ok) {
                    setFullscreenError('Could not enter fullscreen. Allow it in your browser, or try Chrome/Edge.');
                  }
                }}
              >
                Enter Fullscreen &amp; Continue
              </Button>
              <Button variant="ghost" onClick={() => router.push('/my-exams')}>Back to My Exams</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done && result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-4 p-8">
            <h2 className="text-2xl font-bold">Exam Submitted</h2>
            <p className="text-4xl font-bold text-primary">{result.totalScore}/{result.maxScore}</p>
            <p className="text-xl">{result.percentage.toFixed(1)}%</p>
            <Button onClick={() => router.push('/my-exams')}>Back to My Exams</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const question = session.questions[currentIndex];
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const answeredCount = Object.keys(answers).length;

  return (
    <div className={fullscreenRequired ? 'exam-shell-fullscreen relative bg-background' : 'relative min-h-screen bg-background'}>
      {watermarkEnabled && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden opacity-[0.06]">
          <p className="rotate-[-30deg] text-4xl font-bold select-none">{user?.email} · {session.sessionId.slice(0, 8)}</p>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b bg-card/95 px-3 py-2.5 backdrop-blur sm:px-6 sm:py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm sm:text-base">
              Question {currentIndex + 1} of {session.questions.length}
            </p>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {question?.type} · Marks: {question?.marks ?? 2} · Answered: {answeredCount}/{session.questions.length}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {examSocket.connected ? (
              <Badge variant="outline" className="hidden gap-1 text-emerald-600 sm:inline-flex"><Wifi className="h-3 w-3" /> Live</Badge>
            ) : (
              <Badge variant="outline" className="hidden gap-1 text-muted-foreground sm:inline-flex"><WifiOff className="h-3 w-3" /> REST</Badge>
            )}
            {saveStatus === 'saving' && (
              <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving</Badge>
            )}
            {saveStatus === 'saved' && (
              <Badge variant="success" className="hidden gap-1 sm:inline-flex"><Check className="h-3 w-3" /> Saved</Badge>
            )}
            {saveStatus === 'error' && (
              <Badge variant="destructive" className="gap-1">Save failed</Badge>
            )}
            {violations > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {violations}
              </Badge>
            )}
            <Badge variant="secondary" className="hidden gap-1 sm:inline-flex"><Shield className="h-3 w-3" /> Secured</Badge>
            <Badge variant={timeLeft < 300 ? 'destructive' : 'secondary'} className="font-mono tabular-nums">
              {formatTime(timeLeft)}
            </Badge>
            <Button
              variant="destructive"
              size="sm"
              className="sm:h-10 sm:px-4 sm:text-sm"
              onClick={() => setShowSubmitDialog(true)}
              disabled={submitting}
            >
              Submit
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-3 pb-24 sm:p-6 sm:pb-6">
        {question && (
          <Card>
            <CardContent className="space-y-6 p-4 sm:p-6">
              <h2 className="text-base font-medium leading-relaxed sm:text-lg">{question.content?.text || question.title}</h2>
              <QuestionInput
                question={question}
                answer={answers[question.id]}
                onSave={(value) => saveAnswer(question.id, value)}
              />
              <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((i) => i - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    className="flex-1 sm:flex-none"
                    disabled={currentIndex === session.questions.length - 1}
                    onClick={() => setCurrentIndex((i) => i + 1)}
                  >
                    Next
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    const marked = !review[question.id];
                    setReview((r) => ({ ...r, [question.id]: marked }));
                    if (accessToken) examSessionApi.markReview(accessToken, session.sessionId, question.id, marked);
                  }}
                >
                  {review[question.id] ? '✓ Marked for Review' : 'Mark for Review'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {session.questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(i)}
              className={`flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium ${
                i === currentIndex ? 'bg-primary text-primary-foreground'
                : answers[q.id] ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                : review[q.id] ? 'bg-yellow-100 text-yellow-800'
                : 'bg-muted'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </main>

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Exam?</DialogTitle>
            <DialogDescription>
              You have answered {answeredCount} of {session.questions.length} questions.
              {answeredCount < session.questions.length && ' Unanswered questions will receive zero marks.'}
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>Continue Exam</Button>
            <Button variant="destructive" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Confirm Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {proctoringEnabled && (
        <CameraPreview
          videoRef={camera.videoRef}
          canvasRef={camera.canvasRef}
          active={camera.active}
          error={camera.error}
          riskScore={camera.riskScore}
          faceDetected={camera.faceDetected}
        />
      )}
    </div>
  );
}
