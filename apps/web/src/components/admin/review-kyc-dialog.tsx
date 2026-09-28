'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { candidatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { UserCheck, Eye, Loader2 } from 'lucide-react';

export type KycReviewCandidate = {
  id: string;
  registrationNumber: string;
  firstName: string;
  lastName: string;
  email: string;
};

interface ReviewKycDialogProps {
  accessToken: string;
  candidate: KycReviewCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DOCUMENT_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar Card',
  PAN: 'PAN Card',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving License',
  UNKNOWN: 'Unrecognised document',
};

function documentTypeLabel(type: string) {
  return DOCUMENT_LABELS[type] ?? type.replace(/_/g, ' ');
}

function compactId(value?: string | null) {
  return (value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function DocumentPreview({ fileUrl, fileName, mimeType }: { fileUrl: string; fileName: string; mimeType: string }) {
  const isPdf =
    mimeType.includes('pdf') ||
    fileName.toLowerCase().endsWith('.pdf') ||
    fileUrl.startsWith('data:application/pdf');

  if (isPdf) {
    return (
      <iframe
        title={fileName}
        src={fileUrl}
        className="h-[min(320px,42vh)] w-full rounded-lg border border-border/60 bg-muted/20"
      />
    );
  }

  if (fileUrl.startsWith('data:image') || mimeType.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileUrl}
        alt={fileName}
        className="max-h-[min(320px,42vh)] w-full rounded-lg border border-border/60 object-contain bg-muted/20"
      />
    );
  }

  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary hover:underline"
    >
      Open {fileName}
    </a>
  );
}

export function ReviewKycDialog({ accessToken, candidate, open, onOpenChange }: ReviewKycDialogProps) {
  const queryClient = useQueryClient();
  const candidateId = candidate?.id ?? '';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['candidate-kyc', candidateId],
    queryFn: () => candidatesApi.getKycReview(accessToken, candidateId),
    enabled: open && !!candidateId,
  });

  const verifyMutation = useMutation({
    mutationFn: (status: 'VERIFIED' | 'REJECTED') =>
      candidatesApi.verifyKyc(accessToken, candidateId, status),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast({
        title: status === 'VERIFIED' ? 'KYC verified' : 'KYC rejected',
        variant: 'success',
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const doc = data?.documents?.[0];
  const profile = data?.profileData ?? {};
  const docType = profile.documentType ?? doc?.type;
  const idNumber = profile.idNumber;
  const dateOfBirth = profile.dateOfBirth;
  const aiReview = profile.aiVerification;
  const aiReasons = aiReview?.reasons?.filter(Boolean) ?? [];
  const extractedId = aiReview?.extractedIdNumber?.trim();
  const showExtractedId = Boolean(extractedId && compactId(extractedId) !== compactId(idNumber));
  const canReview = data?.kycStatus?.toUpperCase() === 'PENDING';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl sm:p-0">
        <DialogHeader className="shrink-0 px-6 pb-2 pt-6 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Review KYC
            {data?.kycStatus && (
              <Badge variant="warning" className="normal-case">
                {data.kycStatus.replace('_', ' ')}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {candidate
              ? `${candidate.firstName} ${candidate.lastName} · ${candidate.registrationNumber}`
              : 'Student identity documents'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-2">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading documents…
          </div>
        )}

        {isError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {(error as Error).message || 'Could not load KYC details.'}
          </p>
        )}

        {data && !isLoading && (
          <div className="space-y-4">
            <dl className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="mt-0.5 font-medium">{data.user.email}</dd>
              </div>
              {docType && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Document</dt>
                  <dd className="mt-0.5 font-medium">{documentTypeLabel(docType)}</dd>
                </div>
              )}
              {idNumber && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID number</dt>
                  <dd className="mt-0.5 font-mono font-medium">{idNumber}</dd>
                </div>
              )}
              {showExtractedId && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Number read from document
                  </dt>
                  <dd className="mt-0.5 font-mono font-medium">{extractedId}</dd>
                </div>
              )}
              {dateOfBirth && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date of birth</dt>
                  <dd className="mt-0.5 font-medium">
                    {/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
                      ? `${dateOfBirth.slice(8, 10)}/${dateOfBirth.slice(5, 7)}/${dateOfBirth.slice(0, 4)}`
                      : dateOfBirth}
                  </dd>
                </div>
              )}
              {aiReview?.nameOnDocument && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Name read from document
                  </dt>
                  <dd className="mt-0.5 font-medium">{aiReview.nameOnDocument}</dd>
                </div>
              )}
            </dl>

            {aiReview?.outcome === 'MANUAL_REVIEW' && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium">Automatic check needs your review</p>
                {aiReasons.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                    {aiReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    The document was not confirmed automatically.
                  </p>
                )}
                {aiReview.note && (
                  <p className="mt-2 text-muted-foreground">{aiReview.note}</p>
                )}
              </div>
            )}

            {doc ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Uploaded file · {doc.fileName}
                </p>
                <DocumentPreview fileUrl={doc.fileUrl} fileName={doc.fileName} mimeType={doc.mimeType} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No document file found for this student.</p>
            )}
          </div>
        )}
        </div>

        {canReview && (
          <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-background px-6 py-4 sm:gap-0">
            <Button
              type="button"
              variant="destructive"
              disabled={verifyMutation.isPending || isLoading}
              onClick={() => verifyMutation.mutate('REJECTED')}
            >
              Reject
            </Button>
            <Button
              type="button"
              disabled={verifyMutation.isPending || isLoading}
              onClick={() => verifyMutation.mutate('VERIFIED')}
            >
              <UserCheck className="mr-1.5 h-4 w-4" />
              Verify
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
