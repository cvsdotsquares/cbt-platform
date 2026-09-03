export const DEFAULT_EXAM_TIMEZONE = 'Asia/Kolkata';

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export function isUtcIsoOrOffset(value: string): boolean {
  return /[zZ]$|[+-]\d{2}:\d{2}$/.test(value.trim());
}

/** Wall-clock parts in a timezone for a UTC instant. */
function wallTimeInZone(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

/**
 * Convert datetime-local value (YYYY-MM-DDTHH:mm) as wall time in `timeZone`
 * to a UTC ISO string for database storage.
 */
export function localDateTimeToUtcIso(localDateTime: string, timeZone: string): string {
  const match = LOCAL_DATETIME_RE.exec(localDateTime.trim());
  if (!match) throw new Error(`Invalid exam datetime: ${localDateTime}`);

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const targetMinutes = hour * 60 + minute;

  let utcMs = Date.UTC(year, month - 1, day, hour, minute);

  for (let attempt = 0; attempt < 6; attempt++) {
    const wall = wallTimeInZone(utcMs, timeZone);
    const wallMinutes = wall.hour * 60 + wall.minute;
    const dayDelta = wall.day - day;
    const monthDelta = wall.month - month;
    const yearDelta = wall.year - year;
    const totalDayShift = yearDelta * 372 + monthDelta * 31 + dayDelta;
    const diffMinutes = totalDayShift * 24 * 60 + (wallMinutes - targetMinutes);

    if (diffMinutes === 0) break;
    utcMs -= diffMinutes * 60 * 1000;
  }

  return new Date(utcMs).toISOString();
}

/** Parse exam start/end from API — respects timezone for bare datetime-local strings. */
export function parseExamDateTime(value: string, timeZone = DEFAULT_EXAM_TIMEZONE): Date {
  const trimmed = value.trim();
  if (isUtcIsoOrOffset(trimmed)) return new Date(trimmed);
  return new Date(localDateTimeToUtcIso(trimmed, timeZone));
}

export type ExamScheduleValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Default grace for past-start checks (datetime-local is minute-precision; AI create races `new Date()`). */
export const DEFAULT_PAST_START_GRACE_MINUTES = 2;

export type ValidateExamScheduleOptions = {
  /** When true, start time must not be in the past. */
  disallowPastStart?: boolean;
  /** Grace period in minutes before "now" (default {@link DEFAULT_PAST_START_GRACE_MINUTES}). */
  pastGraceMinutes?: number;
  now?: Date;
};

/**
 * Ensures the exam availability window is coherent:
 * - both times valid
 * - end strictly after start
 * - window at least as long as the configured test duration (when provided)
 * - optional: start not in the past
 */
export function validateExamSchedule(
  start: Date,
  end: Date,
  durationMinutes?: number | null,
  options?: ValidateExamScheduleOptions,
): ExamScheduleValidation {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, message: 'Start and end times must be valid dates.' };
  }
  if (end.getTime() <= start.getTime()) {
    return {
      ok: false,
      message: 'End time must be after start time. Choose a later end time for the exam window.',
    };
  }
  if (options?.disallowPastStart) {
    const now = options.now ?? new Date();
    const graceMinutes = options.pastGraceMinutes ?? DEFAULT_PAST_START_GRACE_MINUTES;
    const graceMs = Math.max(0, graceMinutes) * 60_000;
    if (start.getTime() < now.getTime() - graceMs) {
      return {
        ok: false,
        message: 'Start time cannot be in the past. Choose a future start time.',
      };
    }
  }
  const duration = typeof durationMinutes === 'number' && durationMinutes > 0
    ? durationMinutes
    : null;
  if (duration != null) {
    const windowMinutes = (end.getTime() - start.getTime()) / 60_000;
    if (windowMinutes < duration) {
      return {
        ok: false,
        message: `Exam window must be at least ${duration} minutes long (test duration). End time is too early.`,
      };
    }
  }
  return { ok: true };
}

/** Current wall-clock time in `timeZone` as datetime-local value (YYYY-MM-DDTHH:mm). */
export function nowLocalDateTimeInput(timeZone = DEFAULT_EXAM_TIMEZONE): string {
  const wall = wallTimeInZone(Date.now(), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  // Intl hour12:false can yield 24 for midnight in some environments
  const hour = wall.hour === 24 ? 0 : wall.hour;
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(hour)}:${pad(wall.minute)}`;
}

/** Compare datetime-local strings (YYYY-MM-DDTHH:mm). Returns true if end is after start. */
export function isLocalDateTimeAfter(startLocal: string, endLocal: string): boolean {
  if (!startLocal || !endLocal) return false;
  return endLocal > startLocal;
}
