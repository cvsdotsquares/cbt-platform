'use client';

import type { ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

export type CandidateDetailsView = {
  id: string;
  registrationNumber: string;
  gender?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  kycStatus: string;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string } | null;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    status: string;
  };
  enrollment?: {
    className: string;
    classLevel: number;
    batchName: string;
    academicYear: string;
    rollNumber?: string | null;
  } | null;
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-3 py-2 border-b border-border/50 last:border-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

interface ViewCandidateDetailsDialogProps {
  candidate: CandidateDetailsView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ViewCandidateDetailsDialog({
  candidate,
  open,
  onOpenChange,
}: ViewCandidateDetailsDialogProps) {
  const fullName = candidate
    ? `${candidate.user.firstName} ${candidate.user.lastName}`.trim()
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Student details</DialogTitle>
          <DialogDescription>
            {candidate ? `${fullName} · ${candidate.registrationNumber}` : 'Student profile'}
          </DialogDescription>
        </DialogHeader>
        {candidate && (
          <dl className="py-1">
            <DetailRow label="Registration no." value={<span className="font-mono text-xs">{candidate.registrationNumber}</span>} />
            <DetailRow label="Full name" value={fullName} />
            <DetailRow label="Gender" value={candidate.gender} />
            <DetailRow label="Student mobile" value={candidate.user.phone} />
            <DetailRow label="Student email" value={candidate.user.email} />
            <DetailRow
              label="Parent / guardian"
              value={candidate.guardianName}
            />
            <DetailRow label="Guardian mobile" value={candidate.guardianPhone} />
            <DetailRow
              label="Class & batch"
              value={
                candidate.enrollment ? (
                  <span>
                    {candidate.enrollment.className} · {candidate.enrollment.batchName}
                    {candidate.enrollment.academicYear ? ` (${candidate.enrollment.academicYear})` : ''}
                    {candidate.enrollment.rollNumber ? (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Roll {candidate.enrollment.rollNumber}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  'Not assigned'
                )
              }
            />
            <DetailRow
              label="Account"
              value={
                <Badge variant={candidate.user.status === 'ACTIVE' ? 'success' : 'secondary'}>
                  {candidate.user.status}
                </Badge>
              }
            />
            <DetailRow label="KYC" value={candidate.kycStatus.replace('_', ' ')} />
            <DetailRow
              label="Registered by"
              value={
                candidate.createdBy ? (
                  <span>
                    {candidate.createdBy.name}
                    <span className="block text-xs text-muted-foreground">{candidate.createdBy.email}</span>
                  </span>
                ) : (
                  'Self-registered'
                )
              }
            />
            <DetailRow
              label="Registered on"
              value={new Date(candidate.createdAt).toLocaleString()}
            />
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
