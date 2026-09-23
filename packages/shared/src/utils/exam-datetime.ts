export const DEFAULT_EXAM_TIMEZONE = 'Asia/Kolkata';

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

function formatLocalDateTimeInputParts(parts: { year: number; month: number; day: number; hour: number; minute: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(hour)}:${pad(parts.minute)}`;
}

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
    hourCycle: 'h23',
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
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const wallDate = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );

  return (wallDate - date.getTime()) / 60_000;
}

export function localDateTimeToUtcIso(localDateTime: string, timeZone: string): string {
  const match = LOCAL_DATETIME_RE.exec(localDateTime.trim());
  if (!match) throw new Error(`Invalid exam datetime: ${localDateTime}`);

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(targetUtcMs), timeZone);
  return new Date(targetUtcMs - offsetMinutes * 60_000).toISOString();
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
  /** Timezone used to evaluate local wall-clock time for the "past start" rule. */
  timeZone?: string;
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
    const tz = options.timeZone || DEFAULT_EXAM_TIMEZONE;
    const startLocal = wallTimeInZone(start.getTime(), tz);
    const nowLocal = wallTimeInZone(now.getTime(), tz);
    const startAtLocalNow = Date.UTC(
      startLocal.year,
      startLocal.month - 1,
      startLocal.day,
      startLocal.hour,
      startLocal.minute,
    );
    const nowLocalUtc = Date.UTC(
      nowLocal.year,
      nowLocal.month - 1,
      nowLocal.day,
      nowLocal.hour,
      nowLocal.minute,
    );
    if (startAtLocalNow < nowLocalUtc - graceMs) {
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
  return formatLocalDateTimeInputParts(wall);
}

export const DEFAULT_EXAM_START_STEP_MINUTES = 5;

/**
 * Next exam start instant on a `stepMinutes` clock (IST 6:26 → 6:30).
 * Always at least `minAheadMinutes` in the future so the window is not already open.
 */
export function roundUpExamStart(
  now = new Date(),
  options?: { stepMinutes?: number; minAheadMinutes?: number },
): Date {
  const stepMinutes = options?.stepMinutes ?? DEFAULT_EXAM_START_STEP_MINUTES;
  const minAheadMinutes = options?.minAheadMinutes ?? 1;
  const stepMs = Math.max(1, Math.round(stepMinutes)) * 60_000;
  const minStart = now.getTime() + Math.max(0, minAheadMinutes) * 60_000;
  return new Date(Math.ceil(minStart / stepMs) * stepMs);
}

export function getDraftExamWindow(
  durationMinutes: number,
  now = new Date(),
  options?: { stepMinutes?: number; minAheadMinutes?: number },
): { start: Date; end: Date } {
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : 30;
  const start = roundUpExamStart(now, options);
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

/** Convert a UTC ISO instant to `datetime-local` (YYYY-MM-DDTHH:mm) in `timeZone`. */
export function utcIsoToLocalDateTimeInput(iso: string, timeZone = DEFAULT_EXAM_TIMEZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocalDateTimeInputParts(wallTimeInZone(date.getTime(), timeZone));
}

/** Add minutes to a datetime-local value as wall time in `timeZone`. */
export function addMinutesToLocalDateTime(
  localDateTime: string,
  minutes: number,
  timeZone = DEFAULT_EXAM_TIMEZONE,
): string {
  if (!localDateTime) return '';
  const utc = localDateTimeToUtcIso(localDateTime, timeZone);
  return utcIsoToLocalDateTimeInput(new Date(new Date(utc).getTime() + minutes * 60_000).toISOString(), timeZone);
}

export function getDefaultExamScheduleValues(
  timeZone = DEFAULT_EXAM_TIMEZONE,
  durationMinutes = 30,
  now = new Date(),
): { timezone: string; durationMinutes: number; startTime: string; endTime: string } {
  const tz = timeZone || DEFAULT_EXAM_TIMEZONE;
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : 30;
  const { start, end } = getDraftExamWindow(minutes, now);
  return {
    timezone: tz,
    durationMinutes: minutes,
    startTime: formatLocalDateTimeInputParts(wallTimeInZone(start.getTime(), tz)),
    endTime: formatLocalDateTimeInputParts(wallTimeInZone(end.getTime(), tz)),
  };
}

/** Compare datetime-local strings (YYYY-MM-DDTHH:mm). Returns true if end is after start. */
export function isLocalDateTimeAfter(startLocal: string, endLocal: string): boolean {
  if (!startLocal || !endLocal) return false;
  return endLocal > startLocal;
}
