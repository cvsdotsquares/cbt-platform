'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { candidatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { IdCard, Upload } from 'lucide-react';

type KycSubmitCardProps = {
  accessToken: string;
  kycStatus: string;
};

const KYC_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_SUBMITTED: 'outline',
};

export function KycSubmitCard({ accessToken, kycStatus }: KycSubmitCardProps) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState('AADHAAR');
  const [idNumber, setIdNumber] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      candidatesApi.submitKyc(accessToken, { documentType, idNumber, fileName, fileData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidate-dashboard'] });
      setFileName('');
      setFileData('');
      toast({ title: 'KYC submitted', description: 'Your documents are pending review.', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Submission failed', description: e.message, variant: 'destructive' }),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum size is 3MB.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFileData(result);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  }

  const canSubmit = kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED';

  return (
    <Card className="surface-card">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
        <div className="flex items-center gap-2">
          <IdCard className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Identity Verification (KYC)</CardTitle>
        </div>
        <Badge variant={KYC_VARIANTS[kycStatus] ?? 'outline'}>{kycStatus.replace('_', ' ')}</Badge>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {kycStatus === 'VERIFIED' && (
          <p className="text-sm text-muted-foreground">Your identity has been verified. No action needed.</p>
        )}
        {kycStatus === 'PENDING' && (
          <p className="text-sm text-muted-foreground">
            Your documents are under review. You will be notified once verification is complete.
          </p>
        )}
        {canSubmit && (
          <>
            {kycStatus === 'REJECTED' && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Your previous submission was rejected. Please upload corrected documents.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Document type</Label>
                <select
                  className="form-select w-full"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                >
                  <option value="AADHAAR">Aadhaar Card</option>
                  <option value="PAN">PAN Card</option>
                  <option value="PASSPORT">Passport</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>ID number</Label>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Document number" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Upload document (PDF or image, max 3MB)</Label>
              <Input type="file" accept="image/*,.pdf" onChange={handleFile} />
              {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}
            </div>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !idNumber.trim() || !fileData}
            >
              <Upload className="mr-2 h-4 w-4" />
              {submitMutation.isPending ? 'Submitting...' : 'Submit for verification'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
