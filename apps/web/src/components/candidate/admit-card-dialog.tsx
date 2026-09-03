'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Logo } from '@/components/layout/logo';
import { DEFAULT_EXAM_TIMEZONE } from '@cbt/shared';
import { formatExamTimeRange } from '@/lib/exam-dates';
import { Calendar, MapPin, Printer, User } from 'lucide-react';

export type AdmitCard = {
  admitCardId: string;
  candidateName: string;
  candidateEmail: string;
  registrationNumber: string;
  examTitle: string;
  examCode: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  venue: string;
  instructions: string[];
};

interface AdmitCardDialogProps {
  card: AdmitCard | null;
  onClose: () => void;
}

export function AdmitCardDialog({ card, onClose }: AdmitCardDialogProps) {
  function handlePrint() {
    window.print();
  }

  return (
    <Dialog open={!!card} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-lg gap-0 overflow-visible p-0 print:max-w-none print:border-0 print:shadow-none"
        closeClassName="print:hidden -right-2.5 -top-2.5 h-9 w-9 rounded-full border border-border bg-background text-foreground shadow-md opacity-100 hover:bg-muted hover:text-foreground focus:ring-ring"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Admit Card</DialogTitle>
          <DialogDescription>{card?.examTitle}</DialogDescription>
        </DialogHeader>
        {card && (
          <div id="admit-card-print" className="overflow-hidden rounded-[inherit]">
            <div className="gradient-primary px-6 py-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <Logo variant="light" />
                <span className="rounded-md bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest">
                  Admit Card
                </span>
              </div>
              <h2 className="mt-4 text-xl font-bold">{card.examTitle}</h2>
              <p className="text-sm text-white/80">{card.examCode}</p>
            </div>

            <div className="space-y-5 p-6">
              <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <User className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold">{card.candidateName}</p>
                  <p className="text-sm text-muted-foreground">{card.candidateEmail}</p>
                  <p className="mt-1 font-mono text-xs font-semibold text-primary">
                    {card.registrationNumber}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 text-sm">
                <div className="flex items-start gap-3 rounded-lg border border-border/40 px-4 py-3">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Schedule</p>
                    <p className="text-muted-foreground">
                      {formatExamTimeRange(card.startTime, card.endTime, card.timezone || DEFAULT_EXAM_TIMEZONE)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border/40 px-4 py-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Venue</p>
                    <p className="text-muted-foreground">{card.venue}</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">Exam Instructions</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {card.instructions.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-primary">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-end gap-2 border-t border-border/60 pt-4 print:hidden">
                <Button variant="outline" onClick={onClose}>Close</Button>
                <Button onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" /> Print
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
