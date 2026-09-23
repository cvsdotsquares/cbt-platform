type ExamSettings = {
  maxAttempts?: number;
};

type ExamRegistration = {
  exam: { status: string; startTime: string; endTime: string; settings?: ExamSettings };
  sessions?: { status: string }[];
  submittedAttemptCount?: number;
};

export type ExamStatusInfo = {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'secondary';
  actionLabel: string;
  actionDisabled: boolean;
  phase: 'upcoming' | 'available' | 'in_progress' | 'submitted' | 'ended' | 'unavailable' | 'retake';
};

function submittedStatuses() {
  return new Set(['SUBMITTED', 'AUTO_SUBMITTED']);
}

function countSubmitted(reg: ExamRegistration): number {
  if (typeof reg.submittedAttemptCount === 'number') {
    return reg.submittedAttemptCount;
  }
  return (reg.sessions ?? []).filter((s) => submittedStatuses().has(s.status)).length;
}

function maxAttemptsFor(reg: ExamRegistration): number {
  const configured = reg.exam.settings?.maxAttempts;
  if (typeof configured === 'number' && configured >= 1) return Math.floor(configured);
  return 1;
}

function latestSession(reg: ExamRegistration) {
  return reg.sessions?.[0];
}

function windowOpen(reg: ExamRegistration, now: number): boolean {
  if (!reg.exam?.startTime || !reg.exam?.endTime) return false;
  const start = new Date(reg.exam.startTime).getTime();
  const end = new Date(reg.exam.endTime).getTime();
  return now >= start && now <= end;
}

export function getExamStatus(reg: ExamRegistration): ExamStatusInfo {
  const session = latestSession(reg);
  const maxAttempts = maxAttemptsFor(reg);
  const submittedCount = countSubmitted(reg);
  const attemptsExhausted = submittedCount >= maxAttempts;

  if (attemptsExhausted) {
    return {
      label: maxAttempts > 1 ? 'Attempts Used' : 'Submitted',
      variant: 'success',
      actionLabel: maxAttempts > 1 ? 'No Attempts Left' : 'Submitted',
      actionDisabled: true,
      phase: 'submitted',
    };
  }

  if (session?.status === 'IN_PROGRESS') {
    const now = Date.now();
    const end = reg.exam?.endTime ? new Date(reg.exam.endTime).getTime() : NaN;
    if (Number.isFinite(end) && now > end) {
      return {
        label: 'Ended',
        variant: 'secondary',
        actionLabel: 'Ended',
        actionDisabled: true,
        phase: 'ended',
      };
    }
    return {
      label: 'In Progress',
      variant: 'warning',
      actionLabel: 'Resume Exam',
      actionDisabled: false,
      phase: 'in_progress',
    };
  }

  if (!reg.exam?.startTime || !reg.exam?.endTime) {
    return {
      label: 'Unavailable',
      variant: 'secondary',
      actionLabel: 'Unavailable',
      actionDisabled: true,
      phase: 'unavailable',
    };
  }

  const now = Date.now();
  const start = new Date(reg.exam.startTime).getTime();
  const end = new Date(reg.exam.endTime).getTime();

  if (now < start) {
    return {
      label: 'Upcoming',
      variant: 'outline',
      actionLabel: 'Not Yet Open',
      actionDisabled: true,
      phase: 'upcoming',
    };
  }

  if (now > end) {
    if (submittedCount > 0) {
      return {
        label: 'Submitted',
        variant: 'success',
        actionLabel: 'Window Closed',
        actionDisabled: true,
        phase: 'submitted',
      };
    }
    return {
      label: 'Ended',
      variant: 'secondary',
      actionLabel: 'Ended',
      actionDisabled: true,
      phase: 'ended',
    };
  }

  if (reg.exam.status !== 'PUBLISHED') {
    return {
      label: 'Not Published',
      variant: 'secondary',
      actionLabel: 'Not Published',
      actionDisabled: true,
      phase: 'unavailable',
    };
  }

  if (submittedCount > 0 && submittedCount < maxAttempts && windowOpen(reg, now)) {
    return {
      label: `Retake (${submittedCount}/${maxAttempts})`,
      variant: 'default',
      actionLabel: 'Retake Exam',
      actionDisabled: false,
      phase: 'retake',
    };
  }

  return {
    label: 'Available Now',
    variant: 'default',
    actionLabel: 'Start Exam',
    actionDisabled: false,
    phase: 'available',
  };
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
