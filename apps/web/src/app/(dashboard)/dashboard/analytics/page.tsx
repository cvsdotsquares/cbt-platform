'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { examsApi, analyticsApi, aiApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Users, CheckCircle2, AlertTriangle, TrendingUp, Brain, Sparkles } from 'lucide-react';

export default function AnalyticsPage() {
  const { accessToken } = useRequireAuth(true);
  const [examId, setExamId] = useState('');

  const { data: exams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list(accessToken!),
    enabled: !!accessToken,
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', examId],
    queryFn: () => analyticsApi.exam(accessToken!, examId),
    enabled: !!accessToken && !!examId,
  });

  const { data: insights } = useQuery({
    queryKey: ['ai-insights', examId],
    queryFn: () => aiApi.examInsights(accessToken!, examId),
    enabled: !!accessToken && !!examId,
  });

  const insightData = insights as {
    summary?: string[];
    recommendations?: string[];
    metrics?: { avgScore: number; passRate: number; violations: number };
  } | null;

  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" highlight="Analytics" description="Exam performance metrics and AI-powered insights" badge="Insights">
        <select className="form-select w-56" value={examId} onChange={(e) => setExamId(e.target.value)}>
          <option value="">Select exam...</option>
          {(exams as { items?: { id: string; title: string }[] })?.items?.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
      </PageHeader>

      {analytics ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <StatCard title="Registered" value={analytics.registered} icon={Users} accent="blue" />
          <StatCard title="Submitted" value={analytics.submitted} icon={CheckCircle2} accent="green" />
          <StatCard title="Violations" value={analytics.violations} icon={AlertTriangle} accent="red" />
          <StatCard title="Completion" value={`${analytics.completionRate}%`} icon={TrendingUp} accent="violet" />
          <StatCard title="Avg Score" value={`${analytics.averageScore?.toFixed?.(1) ?? 0}%`} icon={Brain} accent="amber" />
        </div>
      ) : null}

      {insightData && (
        <Card className="surface-card border-primary/20">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="flex items-center gap-2.5 text-base font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <Sparkles className="h-4 w-4 text-violet-600" />
              </div>
              AI Insights
              <Badge variant="default">Powered by AI</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {insightData.summary?.map((s, i) => (
                <p key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  {s}
                </p>
              ))}
            </div>
            {insightData.recommendations && insightData.recommendations.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="mb-2 text-sm font-semibold">Recommendations</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {insightData.recommendations.map((r, i) => (
                    <li key={i}>→ {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
