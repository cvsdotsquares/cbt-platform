'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { proctoringApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { ExamSearchSelect } from '@/components/monitoring/exam-search-select';
import { fetchAllExams } from '@/lib/fetch-all-exams';
import { Activity, AlertTriangle, Pause, Play, XCircle, Monitor, Shield } from 'lucide-react';
import { LiveSessionFeed } from '@/components/proctoring/live-session-feed';

type LiveCandidate = {
  sessionId: string;
  name: string;
  riskScore: number;
  status: string;
  timeRemaining?: number;
  recentViolations: number;
  lastActiveSecondsAgo?: number | null;
};

const FEED_STALE_SECONDS = 15;
const CANDIDATE_OFFLINE_SECONDS = 90;

function formatTimeRemaining(seconds?: number) {
  if (seconds == null || seconds <= 0) return '0 min left';
  const mins = Math.ceil(seconds / 60);
  if (mins >= 120) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${mins} min left`;
}

function resolveFeedState(
  candidate: LiveCandidate,
  feed?: { screen?: string; camera?: string; updatedAt?: string },
): 'live' | 'waiting' | 'offline' {
  if (feed?.screen || feed?.camera) {
    if (feed.updatedAt) {
      const ageMs = Date.now() - new Date(feed.updatedAt).getTime();
      if (ageMs <= FEED_STALE_SECONDS * 1000) return 'live';
    } else {
      return 'live';
    }
  }
  const idle = candidate.lastActiveSecondsAgo;
  if (idle != null && idle >= CANDIDATE_OFFLINE_SECONDS) return 'offline';
  return 'waiting';
}

export default function MonitoringPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialExamId = searchParams.get('examId') ?? '';
  const [examId, setExamId] = useState(initialExamId);

  const { data: examList = [], isLoading: examsLoading } = useQuery({
    queryKey: ['exams', 'all-for-monitoring'],
    queryFn: () => fetchAllExams(accessToken!),
    enabled: !!accessToken,
    staleTime: 60_000,
  });

  type LiveMonitoringData = {
    activeCount: number;
    proctoringEnabled?: boolean;
    candidates: LiveCandidate[];
  };

  const { data: live, isLoading: liveLoading, isError: liveError } = useQuery({
    queryKey: ['monitoring', examId],
    queryFn: () => proctoringApi.live(accessToken!, examId) as Promise<LiveMonitoringData>,
    enabled: !!accessToken && !!examId,
    refetchInterval: examId ? 10_000 : false,
  });

  const { data: polledFeeds } = useQuery({
    queryKey: ['monitoring-feeds', examId],
    queryFn: () => proctoringApi.liveFeeds(accessToken!, examId),
    enabled: !!accessToken && !!examId,
    refetchInterval: examId ? 2_000 : false,
  });

  const sessionFeeds = useMemo(() => polledFeeds?.feeds ?? {}, [polledFeeds]);

  const candidates = live?.candidates ?? [];
  const screenFeedEnabled = live?.proctoringEnabled !== false;

  const interveneMutation = useMutation({
    mutationFn: ({ sessionId, type, message }: { sessionId: string; type: string; message?: string }) =>
      proctoringApi.intervene(accessToken!, sessionId, type, message),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['monitoring', examId] });
      toast({ title: `Action: ${vars.type}`, variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Intervention failed', description: e.message, variant: 'destructive' }),
  });

  const highRisk = candidates.filter((c) => c.riskScore > 70).length;
  const liveFeedCount = candidates.filter(
    (c) => resolveFeedState(c, sessionFeeds[c.sessionId]) === 'live',
  ).length;

  return (
    <div className="space-y-8">
      <PageHeader title="Live Monitoring" highlight="Monitoring" description="Real-time student monitoring with AI risk detection and proctor controls" badge="Live">
        <ExamSearchSelect
          exams={examList}
          value={examId}
          onChange={setExamId}
          loading={examsLoading}
        />
      </PageHeader>

      {!examId && (
        <Card className="surface-card">
          <CardContent className="flex flex-col items-center py-20 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Select an exam to begin monitoring</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Choose an exam from the dropdown above to view live student sessions.</p>
          </CardContent>
        </Card>
      )}

      {examId && liveLoading && (
        <Card className="surface-card">
          <CardContent className="py-16 text-center text-muted-foreground">Loading live sessions…</CardContent>
        </Card>
      )}

      {examId && liveError && (
        <Card className="surface-card border-destructive/30">
          <CardContent className="py-16 text-center text-destructive">
            Could not load monitoring data. Check that the API is running and your account has proctoring access for this exam.
          </CardContent>
        </Card>
      )}

      {examId && live && !liveLoading && (
        <>
          {!screenFeedEnabled && (
            <Card className="surface-card border-amber-500/30 bg-amber-500/5">
              <CardContent className="py-4 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Screen sharing is off for this test.</span>{' '}
                You can still see active sessions and integrity violations. New AI tests enable proctoring by default; create a new test or update this exam&apos;s security policy to require live screen feeds.
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            <StatCard title="Active Sessions" value={live.activeCount} icon={Activity} accent="blue" trend="Refreshes every 10s" trendUp />
            <StatCard title="High Risk" value={highRisk} icon={AlertTriangle} accent="red" />
            <StatCard
              title="Live Feeds"
              value={screenFeedEnabled ? liveFeedCount : '—'}
              icon={Monitor}
              accent="green"
              trend={
                !screenFeedEnabled
                  ? 'Not enabled for this exam'
                  : candidates.length
                    ? `${liveFeedCount}/${candidates.length} streaming`
                    : 'No sessions'
              }
              trendUp={screenFeedEnabled && liveFeedCount > 0}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((c) => (
              <Card key={c.sessionId} className={`surface-card transition-all duration-300 ${c.riskScore > 70 ? 'border-red-500/40 ring-1 ring-red-500/20' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold">{c.name}</CardTitle>
                    <Badge variant={c.riskScore > 70 ? 'destructive' : c.riskScore > 40 ? 'warning' : 'success'}>
                      Risk {Math.round(c.riskScore)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <LiveSessionFeed
                    screenThumbnail={sessionFeeds[c.sessionId]?.screen}
                    cameraThumbnail={sessionFeeds[c.sessionId]?.camera}
                    feedState={resolveFeedState(c, sessionFeeds[c.sessionId])}
                    screenFeedEnabled={screenFeedEnabled}
                  />
                  <div className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-muted-foreground">
                    <span>{c.status}</span>
                    <span>{formatTimeRemaining(c.timeRemaining)}</span>
                  </div>
                  <p className="text-muted-foreground">Violations: <span className="font-semibold text-foreground">{c.recentViolations}</span></p>
                  <div className="flex flex-wrap gap-2">
                    {can(Permission.PROCTORING_INTERVENE) && c.status === 'IN_PROGRESS' && (
                      <Button size="sm" variant="outline" onClick={() => interveneMutation.mutate({ sessionId: c.sessionId, type: 'PAUSE' })}>
                        <Pause className="mr-1 h-3 w-3" /> Pause
                      </Button>
                    )}
                    {can(Permission.PROCTORING_INTERVENE) && c.status === 'PAUSED' && (
                      <Button size="sm" variant="outline" onClick={() => interveneMutation.mutate({ sessionId: c.sessionId, type: 'RESUME' })}>
                        <Play className="mr-1 h-3 w-3" /> Resume
                      </Button>
                    )}
                    {can(Permission.PROCTORING_TERMINATE) && (
                    <Button size="sm" variant="destructive" onClick={() => interveneMutation.mutate({ sessionId: c.sessionId, type: 'TERMINATE', message: 'Proctor terminated session' })}>
                      <XCircle className="mr-1 h-3 w-3" /> Terminate
                    </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {!candidates.length && (
            <Card className="surface-card">
              <CardContent className="py-16 text-center text-muted-foreground">No active sessions for this exam.</CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
