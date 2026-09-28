'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
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
import { useScreenProctoring, type ScreenShareFailureReason } from '@/hooks/use-screen-proctoring';
import { CameraPreview } from '@/components/proctoring/camera-preview';
import { QuestionInput } from '@/components/exam/question-input';
import type { ExamSecurityPolicy } from '@cbt/shared';
import { EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD } from '@cbt/shared';
import { normalizeSecurityPolicy, exitDocumentFullscreen, isFullscreenActive } from '@/lib/exam-security-policy';
import {
  clearExamAnswerDraft,
  extractStoredAnswer,
  mergeExamAnswers,
  readExamAnswerDraft,
  writeExamAnswerDraft,
} from '@/lib/exam-answer-draft';
import { AlertTriangle, Shield, Wifi, WifiOff, Check, Loader2, Pause, Monitor } from 'lucide-react';

function httpsUrlForCurrentPage(): string {
  if (typeof window === 'undefined') return '';
  if (window.isSecureContext) return '';
  if (window.location.protocol !== 'http:') return '';
  return window.location.href.replace(/^http:/, 'https:');
}

function screenShareFailureMessage(reason: ScreenShareFailureReason, warningNumber: number): string {
  const prefix = warningNumber > 1 ? `Attempt ${warningNumber}: ` : '';
  const steps =
    'Click Start Screen Recording, then choose Entire screen or this exam tab. The exam will not start until sharing is active.';
  if (reason === 'insecure_context') {
    return `${prefix}This browser blocks screen capture on http:// LAN IPs. Open the exam over https:// on this same address, click Advanced → Continue if a certificate warning appears, then start recording.`;
  }
  if (reason === 'denied') {
    return `${prefix}Screen sharing was denied or cancelled. ${steps}`;
  }
  if (reason === 'wrong_surface') {
    return `${prefix}You must share the full screen or this exam tab, not an app window. ${steps}`;
  }
  return `${prefix}${steps}`;
}

interface Question {
  id: string;
  type: string;
  title: string;
  content: { text?: string };
  options?: Record<string, string>;
  marks: number;
}

export default function ExamStartPage() {
  const params = useParams();
  const examId = params.examId as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, user, ready } = useRequireCandidate();
  const [session, setSession] = useState<{
    sessionId: string;
    questions: Question[];
    timeRemainingSeconds: number;
    riskScore: number;
    exam: { endTime?: string; settings?: Record<string, unknown>; securityPolicy?: ExamSecurityPolicy };
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
  const [screenShareError, setScreenShareError] = useState('');
  const [screenShareFailureCount, setScreenShareFailureCount] = useState(0);
  const [screenSharePromptOpen, setScreenSharePromptOpen] = useState(false);
  const [httpsExamUrl, setHttpsExamUrl] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const answersRef = useRef<Record<string, string | string[]>>({});
  const reviewRef = useRef<Record<string, boolean>>({});
  const questionEnteredAt = useRef(Date.now());
  const submittingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const startInFlightRef = useRef(false);
  const persistAnswerNowRef = useRef<(questionId: string, value: string | string[]) => Promise<void>>(
    async () => {},
  );

  const examSocket = useExamSocket(session?.sessionId ?? null, !!session && !done);

  const securityPolicy = normalizeSecurityPolicy(
    session?.exam?.securityPolicy as Partial<ExamSecurityPolicy> & { fullscreenRequired?: boolean },
  );
  const proctoringEnabled = securityPolicy.proctoringEnabled !== false;

  const camera = useCameraProctoring({
    sessionId: session?.sessionId ?? '',
    enabled: proctoringEnabled && !!session && !done,
  });

  const screenShare = useScreenProctoring({
    sessionId: session?.sessionId ?? '',
    enabled: proctoringEnabled && !!session && !done,
  });

  const pauseIntegrityForScreenShare =
    proctoringEnabled && !!session && !done && (!screenShare.active || screenSharePromptOpen);

  const { violations, enterFullscreen, watermarkEnabled, isFullscreen } = useExamSecurity({
    sessionId: session?.sessionId ?? '',
    accessToken: accessToken ?? '',
    policy: securityPolicy,
    candidateLabel: `${user?.firstName} ${user?.lastName}`,
    enabled: !!session && !done,
    pauseIntegrityReporting: pauseIntegrityForScreenShare,
  });

  const fullscreenRequired = securityPolicy.fullscreen !== false;

  const clampTimeRemaining = (
    seconds: number,
    exam = session?.exam,
  ) => {
    let capped = Math.max(0, seconds);
    const settings = exam?.settings;
    const configuredMinutes = Number(settings?.durationMinutes);
    if (Number.isFinite(configuredMinutes) && configuredMinutes > 0) {
      capped = Math.min(capped, configuredMinutes * 60);
    }
    const endTime = exam?.endTime ? new Date(exam.endTime).getTime() : NaN;
    if (Number.isFinite(endTime)) {
      capped = Math.min(capped, Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
    }
    return capped;
  };

  useLayoutEffect(() => {
    setHttpsExamUrl(httpsUrlForCurrentPage());
  }, []);

  useLayoutEffect(() => {
    if (!securityReady || !session || done || !fullscreenRequired) return;
    if (isFullscreenActive()) void enterFullscreen();
  }, [securityReady, session, done, fullscreenRequired, enterFullscreen]);

  useEffect(() => {
    if (!ready) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    if (sessionIdRef.current || startInFlightRef.current) return;

    let cancelled = false;
    startInFlightRef.current = true;
    examSessionApi.start(token, examId)
      .then(async (data) => {
        if (cancelled) return;
        const d = data as NonNullable<typeof session>;
        if (!d?.sessionId) return;

        const existing: Record<string, string | string[]> = {};
        const reviewState: Record<string, boolean> = {};
        (d.responses || []).forEach((r) => {
          if (r.markedForReview) reviewState[r.questionId] = true;
          const val = extractStoredAnswer(r.answer);
          if (val !== undefined) existing[r.questionId] = val;
        });
        const draft = readExamAnswerDraft(d.sessionId, examId);
        const merged = mergeExamAnswers(existing, draft);
        for (const [questionId, value] of Object.entries(answersRef.current)) {
          if (extractStoredAnswer(value) != null) merged[questionId] = value;
        }
        if (draft) {
          Object.entries(draft.review || {}).forEach(([questionId, marked]) => {
            if (marked) reviewState[questionId] = true;
          });
        }
        for (const [questionId, marked] of Object.entries(reviewRef.current)) {
          if (marked) reviewState[questionId] = true;
        }

        const continuing = sessionIdRef.current === d.sessionId;
        answersRef.current = merged;
        reviewRef.current = reviewState;
        setAnswers({ ...merged });
        setReview({ ...reviewState });
        writeExamAnswerDraft({
          sessionId: d.sessionId,
          examId,
          answers: merged,
          review: reviewState,
          updatedAt: Date.now(),
        });

        if (!continuing) {
          sessionIdRef.current = d.sessionId;
          setSession(d);
          setTimeLeft(clampTimeRemaining(d.timeRemainingSeconds, d.exam));
          setSecurityReady(true);
        }

        const liveToken = useAuthStore.getState().accessToken ?? token;
        await Promise.all(Object.entries(merged).map(async ([questionId, value]) => {
          if (extractStoredAnswer(value) == null) return;
          const serverValue = extractStoredAnswer(existing[questionId]);
          if (JSON.stringify(serverValue) === JSON.stringify(extractStoredAnswer(value))) return;
          try {
            await examSessionApi.saveAnswer(liveToken, d.sessionId, {
              questionId,
              answer: { value },
              timeSpentSeconds: 1,
              markedForReview: reviewState[questionId] || false,
            });
          } catch {
            /* next navigation or heartbeat retries the save */
          }
        }));
      })
      .catch((e) => {
        if (!cancelled && !sessionIdRef.current) setError(e instanceof Error ? e.message : 'Could not start exam');
      })
      .finally(() => {
        if (!cancelled) startInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
      startInFlightRef.current = false;
    };
  // Re-fetch after a token refresh must not replace an in-progress session.
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
    const token = useAuthStore.getState().accessToken;
    if (!session || !token) return;
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return;
    const timeSpentSeconds = getTimeSpentSeconds();
    const body = {
      questionId,
      answer: { value },
      timeSpentSeconds,
      markedForReview: reviewRef.current[questionId] || false,
    };
    const markSaved = () => {
      setSaveStatus('saved');
      if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
    };
    try {
      await examSessionApi.saveAnswer(token, session.sessionId, body);
      markSaved();
    } catch {
      try {
        if (!examSocket.connected) throw new Error('Exam socket not connected');
        await examSocket.saveAnswer({
          sessionId: session.sessionId,
          ...body,
        });
        markSaved();
      } catch {
        setSaveStatus('error');
      }
    }
  }, [session, examSocket]);

  const saveDraftSnapshot = useCallback(() => {
    if (!session) return;
    writeExamAnswerDraft({
      sessionId: session.sessionId,
      examId,
      answers: answersRef.current,
      review: reviewRef.current,
      updatedAt: Date.now(),
    });
  }, [session, examId]);

  const saveAnswer = useCallback((questionId: string, value: string | string[]) => {
    if (!session) return;
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
    setSaveStatus('saving');
    writeExamAnswerDraft({
      sessionId: session.sessionId,
      examId,
      answers: next,
      review: reviewRef.current,
      updatedAt: Date.now(),
    });

    // Typed answers are debounced. Choice answers save on the next tick, always from the latest value.
    const delay = typeof value === 'string' && value.length > 1 ? 400 : 80;
    if (persistTimers.current[questionId]) clearTimeout(persistTimers.current[questionId]);
    persistTimers.current[questionId] = setTimeout(() => {
      delete persistTimers.current[questionId];
      const latest = answersRef.current[questionId];
      if (latest == null) return;
      void persistAnswerNowRef.current(questionId, latest);
    }, delay);
  }, [session, examId]);

  useEffect(() => {
    persistAnswerNowRef.current = persistAnswerNow;
  }, [persistAnswerNow]);

  const flushPendingSaves = useCallback(() => {
    const pending = Object.entries(persistTimers.current);
    persistTimers.current = {};
    for (const [questionId, timer] of pending) {
      clearTimeout(timer);
      const value = answersRef.current[questionId];
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
      void persistAnswerNowRef.current(questionId, value);
    }
  }, []);

  const violationSubmitTriggered = useRef(false);

  const finishExam = useCallback((result: { totalScore: number; maxScore: number; percentage: number }) => {
    if (session?.sessionId) clearExamAnswerDraft(session.sessionId, examId);
    setResult(result);
    setDone(true);
    queryClient.invalidateQueries({ queryKey: ['candidate-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['my-exams'] });
    queryClient.invalidateQueries({ queryKey: ['my-results'] });
    if (isFullscreenActive()) void exitDocumentFullscreen();
  }, [queryClient, session?.sessionId, examId]);

  const handleSubmit = useCallback(async () => {
    if (!session || !accessToken || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setShowSubmitDialog(false);

    flushPendingSaves();

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
  }, [session, accessToken, finishExam, buildPendingAnswers, flushPendingSaves]);

  const flushAnswersOnLeave = useCallback(() => {
    if (!session || !accessToken || submittingRef.current || done) return;
    flushPendingSaves();
    saveDraftSnapshot();
    const pending = buildPendingAnswers();
    if (!pending.length) return;
    try {
      void fetch(`/api/v1/exam-sessions/${session.sessionId}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Tenant-ID': user?.tenantId || 'default',
        },
        body: JSON.stringify({ answers: pending }),
        keepalive: true,
        credentials: 'include',
      });
    } catch {
      /* draft already written */
    }
  }, [session, accessToken, done, saveDraftSnapshot, buildPendingAnswers, user?.tenantId, flushPendingSaves]);

  const openExamOverHttps = useCallback(() => {
    if (!httpsExamUrl) return;
    flushAnswersOnLeave();
    window.location.replace(httpsExamUrl);
  }, [httpsExamUrl, flushAnswersOnLeave]);

  useEffect(() => {
    if (!session || done) return;
    const onPageHide = () => flushAnswersOnLeave();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAnswersOnLeave();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, done, flushAnswersOnLeave]);

  const handleScreenShareAttempt = useCallback(async () => {
    if (submittingRef.current) return;
    setScreenSharePromptOpen(true);
    setScreenShareError('');
    try {
      const result = await screenShare.startScreenShare();
      if (result.ok) {
        setScreenShareFailureCount(0);
        return;
      }
      setScreenShareFailureCount((prev) => {
        const next = prev + 1;
        setScreenShareError(screenShareFailureMessage(result.reason, next));
        return next;
      });
    } finally {
      setScreenSharePromptOpen(false);
    }
  }, [screenShare.startScreenShare]);

  useEffect(() => {
    if (!session || done || submittingRef.current || violationSubmitTriggered.current) return;
    if (violations <= EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD) return;
    violationSubmitTriggered.current = true;
    setError('Too many proctoring violations. Submitting your exam automatically.');
    void handleSubmit();
  }, [violations, session, done, handleSubmit]);

  useEffect(() => {
    if (!session || done) return;
    const interval = setInterval(async () => {
      const token = useAuthStore.getState().accessToken;
      if (!token || submittingRef.current) return;
      const answers = buildPendingAnswers();
      try {
        type HeartbeatState = {
          timeRemainingSeconds: number;
          autoSubmitted: boolean;
          paused?: boolean;
          terminated?: boolean;
          result?: { totalScore: number; maxScore: number; percentage: number };
        };
        let hb: HeartbeatState;
        try {
          hb = await examSessionApi.heartbeat(token, session.sessionId, { answers }) as HeartbeatState;
        } catch {
          if (!examSocket.connected) throw new Error('heartbeat failed');
          hb = await examSocket.heartbeat(session.sessionId, answers);
        }
        if (hb.terminated) {
          setError('This exam session was terminated by a proctor.');
          return;
        }
        if (!hb.paused) {
          setTimeLeft(clampTimeRemaining(hb.timeRemainingSeconds));
        }
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
      setTimeLeft((t) => clampTimeRemaining(Math.max(0, t - 1), session.exam));
    }, 1000);
    return () => clearInterval(timer);
  }, [session, done]);

  useEffect(() => {
    if (done || !session || !accessToken || timeLeft > 0 || submittingRef.current) return;
    void handleSubmit();
  }, [timeLeft, done, session, accessToken, handleSubmit]);

  useEffect(() => {
    if (examSocket.proctorState.terminated) {
      setError(examSocket.proctorState.message || 'This exam session was terminated by a proctor.');
    }
  }, [examSocket.proctorState]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  if (error) return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="p-6"><p className="text-destructive">{error}</p><Button className="mt-4" onClick={() => router.push('/my-exams')}>Back</Button></Card>
    </div>
  );
  if (!session || !securityReady) return <div className="flex min-h-screen items-center justify-center">Initializing secure exam environment...</div>;

  if (proctoringEnabled && !screenShare.active && (!fullscreenRequired || isFullscreen)) {
    return (
      <div className="exam-shell-fullscreen flex items-center justify-center bg-background p-4">
        <canvas ref={screenShare.canvasRef} className="hidden" />
        <video ref={screenShare.videoRef} className="hidden" muted playsInline />
        <Card className="w-full max-w-md">
          <CardContent className="space-y-5 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Monitor className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Share Your Exam Screen</h2>
              <p className="text-sm text-muted-foreground">
                Enter fullscreen when asked, then share your screen here. Choose Entire screen or this exam tab. Screen sharing must stay on for the whole test — failed attempts show a message below; your exam is not submitted for sharing issues.
              </p>
            </div>
            {httpsExamUrl && (
              <p className="text-sm text-destructive">
                Screen capture is blocked on http:// LAN addresses. Open this exam over HTTPS, click Advanced → Continue if a certificate warning appears, then start recording.
              </p>
            )}
            {(screenShareError || screenShare.error) && !httpsExamUrl && (
              <p className="text-sm text-destructive">{screenShareError || screenShare.error}</p>
            )}
            <div className="flex flex-col gap-2">
              {httpsExamUrl ? (
                <Button size="lg" onClick={openExamOverHttps}>
                  Open over HTTPS
                </Button>
              ) : (
                <Button
                  size="lg"
                  disabled={screenSharePromptOpen}
                  onClick={() => void handleScreenShareAttempt()}
                >
                  {screenSharePromptOpen ? 'Waiting for screen share…' : 'Start Screen Recording'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => router.push('/my-exams')}>Back to My Exams</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
      <canvas ref={screenShare.canvasRef} className="hidden" />
      <video ref={screenShare.videoRef} className="hidden" muted playsInline />
      {proctoringEnabled && !screenShare.active && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="space-y-4 p-8">
              <Monitor className="mx-auto h-10 w-10 text-primary" />
              <h2 className="text-xl font-bold">Screen Share Required</h2>
              <p className="text-sm text-muted-foreground">
                {httpsExamUrl
                  ? 'Screen capture is blocked on this http:// address. Open the exam over HTTPS, then resume sharing.'
                  : (screenShareError || screenShare.error || 'Your screen must stay shared so proctors can monitor this exam.')}
              </p>
              {httpsExamUrl ? (
                <Button size="lg" onClick={openExamOverHttps}>
                  Open over HTTPS
                </Button>
              ) : (
                <Button
                  size="lg"
                  disabled={screenSharePromptOpen}
                  onClick={() => void handleScreenShareAttempt()}
                >
                  {screenSharePromptOpen ? 'Waiting for screen share…' : 'Resume Screen Share'}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {examSocket.proctorState.paused && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="space-y-4 p-8">
              <Pause className="mx-auto h-10 w-10 text-amber-500" />
              <h2 className="text-xl font-bold">Exam Paused</h2>
              <p className="text-sm text-muted-foreground">
                {examSocket.proctorState.message || 'A proctor has paused your session. Please wait.'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
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
                    type="button"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    disabled={currentIndex === 0}
                    onClick={() => {
                      flushPendingSaves();
                      setCurrentIndex((i) => i - 1);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 sm:flex-none"
                    disabled={currentIndex === session.questions.length - 1}
                    onClick={() => {
                      flushPendingSaves();
                      setCurrentIndex((i) => i + 1);
                    }}
                  >
                    Next
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    const marked = !review[question.id];
                    const nextReview = { ...reviewRef.current, [question.id]: marked };
                    reviewRef.current = nextReview;
                    setReview(nextReview);
                    writeExamAnswerDraft({
                      sessionId: session.sessionId,
                      examId,
                      answers: answersRef.current,
                      review: nextReview,
                      updatedAt: Date.now(),
                    });
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
              type="button"
              onClick={() => {
                flushPendingSaves();
                setCurrentIndex(i);
              }}
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
