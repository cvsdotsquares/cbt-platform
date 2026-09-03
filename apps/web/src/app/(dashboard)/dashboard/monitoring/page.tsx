'use client';

import { useState, useEffect, useMemo } from 'react';
import { getProctoringSocket } from '@/lib/socket';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { examsApi, proctoringApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Activity, AlertTriangle, Pause, Play, XCircle, Radio, Shield } from 'lucide-react';

type LiveCandidate = {
  sessionId: string;
  name: string;
  riskScore: number;
  status: string;
  timeRemaining?: number;
  recentViolations: number;
};

type RiskPatch = {
  riskScore: number;
  violations?: unknown[];
};

export default function MonitoringPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [examId, setExamId] = useState('');
  const [liveAlerts, setLiveAlerts] = useState<{ sessionId: string; type: string; severity: string; timestamp: string }[]>([]);
  const [riskPatches, setRiskPatches] = useState<Record<string, RiskPatch>>({});

  useEffect(() => {
    setRiskPatches({});
  }, [examId]);

  useEffect(() => {
    const socket = getProctoringSocket();
    if (!socket) return;
    socket.connect();
    socket.emit('proctoring:join-monitoring');

    const onViolation = (data: { sessionId: string; type: string; severity: string; timestamp: string }) => {
      setLiveAlerts((prev) => [data, ...prev].slice(0, 20));
      toast({ title: `Violation: ${data.type}`, description: `Severity: ${data.severity}`, variant: 'destructive' });
    };

    const onRiskUpdate = (data: { sessionId: string; riskScore: number; violations?: unknown[] }) => {
      setRiskPatches((prev) => ({
        ...prev,
        [data.sessionId]: { riskScore: data.riskScore, violations: data.violations },
      }));
    };

    socket.on('proctoring:violation', onViolation);
    socket.on('proctoring:risk-update', onRiskUpdate);

    return () => {
      socket.off('proctoring:violation', onViolation);
      socket.off('proctoring:risk-update', onRiskUpdate);
    };
  }, []);

  const { data: exams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

type LiveMonitoringData = {
  activeCount: number;
  candidates: LiveCandidate[];
};

  const { data: live } = useQuery({
    queryKey: ['monitoring', examId],
    queryFn: () => proctoringApi.live(accessToken!, examId) as Promise<LiveMonitoringData>,
    enabled: !!accessToken && !!examId,
    refetchInterval: 30000,
  });

  const candidates = useMemo(() => {
    const base = live?.candidates || [];
    return base.map((c) => {
      const patch = riskPatches[c.sessionId];
      if (!patch) return c;
      return {
        ...c,
        riskScore: patch.riskScore,
        recentViolations: patch.violations?.length ?? c.recentViolations,
      };
    });
  }, [live?.candidates, riskPatches]);

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

  return (
    <div className="space-y-8">
      <PageHeader title="Live Monitoring" highlight="Monitoring" description="Real-time candidate monitoring with AI risk detection and proctor controls" badge="Live">
        <select className="form-select w-56" value={examId} onChange={(e) => setExamId(e.target.value)}>
          <option value="">Select exam...</option>
          {(exams?.items ?? []).filter((e) => e.status === 'PUBLISHED').map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
      </PageHeader>

      {!examId && (
        <Card className="surface-card">
          <CardContent className="flex flex-col items-center py-20 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Select an exam to begin monitoring</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Choose a published exam from the dropdown above to view live candidate sessions.</p>
          </CardContent>
        </Card>
      )}

      {examId && live && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            <StatCard title="Active Sessions" value={live.activeCount} icon={Activity} accent="blue" trend="Real-time" trendUp />
            <StatCard title="High Risk" value={highRisk} icon={AlertTriangle} accent="red" />
            <StatCard title="Connection" value="Live" icon={Radio} accent="green" trend="WebSocket + REST" trendUp />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <div className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-muted-foreground">
                    <span>{c.status}</span>
                    <span>{c.timeRemaining ? Math.floor(c.timeRemaining / 60) : 0} min left</span>
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

          {liveAlerts.length > 0 && (
            <Card className="surface-card border-destructive/30">
              <CardHeader className="border-b border-destructive/20">
                <CardTitle className="flex items-center gap-2 text-base font-bold text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Live AI Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-4">
                {liveAlerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-destructive/10 bg-destructive/5 px-4 py-3 text-sm">
                    <span className="font-medium">{a.type} · Session {a.sessionId.slice(0, 8)}</span>
                    <Badge variant="destructive">{a.severity}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
