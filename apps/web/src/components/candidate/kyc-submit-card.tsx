'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { candidatesApi } from '@/lib/api';
import { kycBirthDateDisplay } from '@/lib/kyc-birth-date';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ChevronDown, IdCard, Loader2 } from 'lucide-react';

export type KycExtractedDocument = {
  documentType?: string;
  name?: string;
  idNumber?: string;
  dateOfBirth?: string;
  dateOfBirthPrecision?: string;
  reviewMessage?: string;
};

type KycSubmitCardProps = {
  accessToken: string;
  kycStatus: string;
  kycDocument?: KycExtractedDocument | null;
};

const KYC_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_SUBMITTED: 'outline',
};

const DOCUMENT_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar card',
  PAN: 'PAN card',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving licence',
  UNKNOWN: 'Unrecognised document',
};

function documentTypeLabel(type?: string) {
  if (!type) return 'Not readable';
  return DOCUMENT_LABELS[type] ?? type.replace(/_/g, ' ');
}

function displayValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'Not readable';
}

export function KycSubmitCard({ accessToken, kycStatus, kycDocument }: KycSubmitCardProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [extracted, setExtracted] = useState<KycExtractedDocument | null>(null);
  const [expanded, setExpanded] = useState(true);

  const submitMutation = useMutation({
    mutationFn: (body: { fileName: string; fileData: string }) => candidatesApi.submitKyc(accessToken, body),
    onSuccess: (result) => {
      setExtracted({
        ...result.extracted,
        reviewMessage: result.kycStatus === 'PENDING' ? result.message : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['candidate-dashboard'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (result.kycStatus === 'VERIFIED') {
        toast({
          title: 'Identity verified',
          description: result.message || 'The details on your document were confirmed.',
          variant: 'success',
        });
        return;
      }
      toast({
        title: 'Sent for administrator review',
        description: result.message || 'Automatic verification could not confirm this document.',
        variant: 'success',
      });
    },
    onError: (e: Error) => {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFileName('');
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      e.target.value = '';
      toast({ title: 'File too large', description: 'Maximum size is 3MB.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const fileData = reader.result as string;
      setFileName(file.name);
      submitMutation.mutate({ fileName: file.name, fileData });
    };
    reader.readAsDataURL(file);
  }

  const canSubmit = kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED';
  const details = extracted ?? kycDocument ?? null;
  const birthDate = kycBirthDateDisplay(details?.dateOfBirth, details?.dateOfBirthPrecision);
  const showDetails = Boolean(details && (extracted || kycStatus !== 'NOT_SUBMITTED'));
  const showBody = expanded || submitMutation.isPending;

  return (
    <Card className="surface-card">
      <CardHeader
        className={cn('pb-4', showBody && 'border-b border-border/60')}
      >
        <button
          type="button"
          aria-expanded={showBody}
          aria-label={showBody ? 'Collapse identity details' : 'Expand identity details'}
          disabled={submitMutation.isPending}
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <IdCard className="h-5 w-5 shrink-0 text-primary" />
            <CardTitle className="text-base">Identity Verification (KYC)</CardTitle>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge variant={KYC_VARIANTS[kycStatus] ?? 'outline'}>{kycStatus.replace('_', ' ')}</Badge>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showBody ? 'rotate-0' : '-rotate-90')} />
          </span>
        </button>
      </CardHeader>
      {showBody && (
      <CardContent className="space-y-4 pt-6">
        {kycStatus === 'VERIFIED' && (
          <p className="text-sm text-muted-foreground">Your identity has been verified. You can take class tests.</p>
        )}
        {kycStatus === 'PENDING' && (
          <p className="text-sm text-muted-foreground">
            {details?.reviewMessage
              ? `${details.reviewMessage.replace(/\.\s*An administrator will review it\.?$/i, '').replace(/\.$/, '')}. An administrator is reviewing it.`
              : 'Automatic verification could not confirm this document, so an administrator is reviewing it.'}{' '}
            Class tests stay locked until it is verified.
          </p>
        )}
        {showDetails && details && (
          <dl className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Document type</dt>
              <dd className="mt-0.5 font-medium">{documentTypeLabel(details.documentType)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</dt>
              <dd className="mt-0.5 font-medium">{displayValue(details.name)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Number</dt>
              <dd className="mt-0.5 font-mono font-medium">{displayValue(details.idNumber)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {birthDate?.label ?? 'Year of birth'}
              </dt>
              <dd className="mt-0.5 font-medium">{birthDate?.text ?? 'Not readable'}</dd>
            </div>
          </dl>
        )}
        {canSubmit && (
          <>
            <p className="text-sm text-muted-foreground">
            Upload your Aadhaar, PAN, passport, or driving licence for verification
            </p>
            {kycStatus === 'REJECTED' && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Your previous submission was rejected. Upload a corrected document before you can take a test.
              </p>
            )}
            <div className="space-y-2">
              <Label>Upload document (PDF or image, max 3MB)</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFile}
                disabled={submitMutation.isPending}
              />
              {submitMutation.isPending && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading {fileName || 'your document'}…
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
      )}
    </Card>
  );
}
