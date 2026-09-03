'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Logo } from '@/components/layout/logo';
import { Award, Download, Printer } from 'lucide-react';
import type { CertificateData } from '@/lib/certificate';
import { downloadCertificateHtml, printCertificate } from '@/lib/certificate';
import { formatRankLabel } from '@/lib/rank';

interface CertificateDialogProps {
  certificate: CertificateData | null;
  loading?: boolean;
  onClose: () => void;
}

export function CertificateDialog({ certificate, loading, onClose }: CertificateDialogProps) {
  const passed = certificate
    ? certificate.percentage >= (certificate.passingScore ?? 40)
    : false;
  const issued = certificate
    ? new Date(certificate.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <Dialog open={!!certificate || !!loading} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-2xl gap-0 overflow-visible p-0"
        closeClassName="print:hidden -right-2.5 -top-2.5 h-9 w-9 rounded-full border border-border bg-background text-foreground shadow-md opacity-100 hover:bg-muted hover:text-foreground focus:ring-ring"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Exam Certificate</DialogTitle>
          <DialogDescription>{certificate?.examTitle ?? 'Generating certificate'}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[inherit] px-6 py-20 text-muted-foreground">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium">Generating certificate…</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}

        {certificate && !loading && (
          <div id="certificate-preview" className="overflow-hidden rounded-[inherit]">
            <div className="gradient-primary px-6 py-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <Logo variant="light" />
                <span className="rounded-md bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest">
                  Certificate
                </span>
              </div>
            </div>

            <div className="space-y-6 p-6 sm:p-8">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5">
                  <Award className="h-8 w-8 text-primary" />
                </div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Certificate of Achievement
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight">This certifies that</h2>
                <p className="mt-3 text-3xl font-bold text-primary">{certificate.candidateName}</p>
                <p className="mt-4 text-muted-foreground">has successfully completed</p>
                <p className="mt-1 text-xl font-semibold">{certificate.examTitle}</p>
                <p className="text-sm text-muted-foreground">{certificate.examCode}</p>
              </div>

              <div className="mx-auto max-w-sm rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-violet-500/5 p-6 text-center">
                <p className="text-4xl font-bold tabular-nums text-primary">
                  {certificate.totalScore}
                  <span className="text-lg font-normal text-muted-foreground">/{certificate.maxScore}</span>
                </p>
                <p className={`mt-1 text-sm font-bold ${passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {certificate.percentage.toFixed(1)}% — {passed ? 'Passed' : 'Completed'}
                </p>
                {certificate.rank != null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatRankLabel(certificate.rank, certificate.totalCandidates)}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                <div>
                  <p className="font-semibold text-foreground">Issued {issued}</p>
                  <p className="mt-1 font-mono">{certificate.certificateNumber}</p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary/30 text-center text-[9px] font-bold uppercase leading-tight text-primary">
                  CBT<br />Verified
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4 print:hidden">
                <Button variant="outline" onClick={onClose}>Close</Button>
                <Button variant="outline" onClick={() => downloadCertificateHtml(certificate)}>
                  <Download className="mr-2 h-4 w-4" /> Download
                </Button>
                <Button onClick={() => printCertificate(certificate)}>
                  <Printer className="mr-2 h-4 w-4" /> Save as PDF
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
