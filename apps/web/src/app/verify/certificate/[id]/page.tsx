'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { resultsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/layout/logo';
import { CheckCircle2, XCircle, Shield } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

type VerifyResult = {
  valid: boolean;
  certificateNumber: string;
  candidateName: string;
  examTitle: string;
  examCode: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passingScore: number;
  passed: boolean;
  rank?: number | null;
  issuedAt: string;
};

export default function VerifyCertificatePage() {
  const params = useParams();
  const id = params.id as string;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['verify-certificate', id],
    queryFn: () => resultsApi.verifyCertificate(id) as Promise<VerifyResult>,
    enabled: !!id,
    retry: 1,
  });

  return (
    <div className="min-h-screen mesh-bg">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Logo />
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Shield className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">Certificate Verification</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Verify the authenticity of an examination certificate
          </p>
        </div>

        {isLoading && (
          <Card className="surface-card">
            <CardContent className="py-12 text-center text-muted-foreground">Verifying...</CardContent>
          </Card>
        )}

        {isError && (
          <Card className="surface-card border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Certificate not found</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'This certificate ID is invalid or results are not published.'}
              </p>
            </CardContent>
          </Card>
        )}

        {data && (
          <Card className="surface-card">
            <CardHeader className="border-b border-border/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Verification Result</CardTitle>
                <Badge variant={data.valid ? 'success' : 'destructive'} className="gap-1">
                  {data.valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {data.valid ? 'Valid' : 'Invalid'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Certificate No.</p>
                  <p className="font-mono font-semibold">{data.certificateNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Issued</p>
                  <p className="font-medium">{new Date(data.issuedAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Candidate</p>
                  <p className="font-medium">{data.candidateName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Examination</p>
                  <p className="font-medium">{data.examTitle}</p>
                  <p className="text-xs text-muted-foreground">{data.examCode}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Score</p>
                  <p className="font-medium">{data.totalScore}/{data.maxScore} ({data.percentage.toFixed(1)}%)</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Result</p>
                  <Badge variant={data.passed ? 'success' : 'secondary'}>
                    {data.passed ? 'Passed' : 'Not passed'} (min {data.passingScore}%)
                  </Badge>
                </div>
                {data.rank != null && (
                  <div>
                    <p className="text-muted-foreground">Rank</p>
                    <p className="font-medium">#{data.rank}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
