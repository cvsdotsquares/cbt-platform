'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { onboardingApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { CheckCircle2, Circle, ArrowRight, School } from 'lucide-react';
import { cn } from '@/lib/utils';

type SetupStep = {
  id: string;
  order: number;
  title: string;
  description: string;
  href: string;
  done: boolean;
  detail: string;
};

type SetupStatus = {
  progress: number;
  completed: number;
  total: number;
  steps: SetupStep[];
};

export default function SchoolSetupPage() {
  const { accessToken } = useRequireAuth(true);

  const { data: setup, isLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => onboardingApi.setupStatus(accessToken!) as Promise<SetupStatus>,
    enabled: !!accessToken,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="School onboarding"
        description="Set up your institute step by step — classes, students, materials, syllabus, and class tests."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading setup status…</p>}

      {setup && (
        <>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <School className="h-5 w-5 text-primary" />
                  <Badge variant="secondary">{setup.progress}% complete</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {setup.completed} of {setup.total} steps done. Finish each step so students can take NCERT class tests.
                </p>
                <div className="h-2 max-w-md overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-all"
                    style={{ width: `${setup.progress}%` }}
                  />
                </div>
              </div>
              <Button asChild>
                <Link href="/dashboard">
                  Back to dashboard <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Setup checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {setup.steps.map((step) => (
                <Link
                  key={step.id}
                  href={step.href}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/40',
                    step.done ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border/60',
                  )}
                >
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/50" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {step.order}. {step.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                    <p className="mt-1 text-xs font-medium text-primary">{step.detail}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
