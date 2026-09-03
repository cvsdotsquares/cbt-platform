type ExamRegistration = {
  exam: { status: string; startTime: string; endTime: string };
  sessions?: { status: string }[];
};

export type ExamStatusInfo = {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'secondary';
  actionLabel: string;
  actionDisabled: boolean;
  phase: 'upcoming' | 'available' | 'in_progress' | 'submitted' | 'ended' | 'unavailable';
};

export function getExamStatus(reg: ExamRegistration): ExamStatusInfo {
  const session = reg.sessions?.[0];
  const submitted = session?.status === 'SUBMITTED' || session?.status === 'AUTO_SUBMITTED';
  if (submitted) {
    return { label: 'Submitted', variant: 'success', actionLabel: 'Submitted', actionDisabled: true, phase: 'submitted' };
  }

  // Active session takes priority — candidate can resume even past exam window end
  if (session?.status === 'IN_PROGRESS') {
    return { label: 'In Progress', variant: 'warning', actionLabel: 'Resume Exam', actionDisabled: false, phase: 'in_progress' };
  }

  if (!reg.exam?.startTime || !reg.exam?.endTime) {
    return { label: 'Unavailable', variant: 'secondary', actionLabel: 'Unavailable', actionDisabled: true, phase: 'unavailable' };
  }

  const now = Date.now();
  const start = new Date(reg.exam.startTime).getTime();
  const end = new Date(reg.exam.endTime).getTime();

  if (now < start) {
    return { label: 'Upcoming', variant: 'outline', actionLabel: 'Not Yet Open', actionDisabled: true, phase: 'upcoming' };
  }
  if (now > end) {
    return { label: 'Ended', variant: 'secondary', actionLabel: 'Ended', actionDisabled: true, phase: 'ended' };
  }
  if (!['PUBLISHED', 'IN_PROGRESS'].includes(reg.exam.status)) {
    return { label: 'Not Published', variant: 'secondary', actionLabel: 'Not Published', actionDisabled: true, phase: 'unavailable' };
  }
  return { label: 'Available Now', variant: 'default', actionLabel: 'Start Exam', actionDisabled: false, phase: 'available' };
}

export function formatCountdown(targetMs: number): string {
  const diff = Math.max(0, targetMs - Date.now());
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
