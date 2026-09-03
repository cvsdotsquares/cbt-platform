import { DEFAULT_EXAM_TIMEZONE } from '@cbt/shared';

/** Friendly abbreviations for common exam timezones (avoids "GMT+5:30" in UI). */
const TIMEZONE_LABELS: Record<string, string> = {
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'Europe/London': 'GMT',
  'Europe/Paris': 'CET',
  'Asia/Dubai': 'GST',
  'Asia/Singapore': 'SGT',
  'Australia/Sydney': 'AEST',
};

export const EXAM_TIMEZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Dubai', label: 'Gulf (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Europe/London', label: 'UK (GMT/BST)' },
  { value: 'America/New_York', label: 'US Eastern (ET)' },
] as const;

function normalizeTimeText(text: string): string {
  return text.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
}

/** Short timezone label shown next to exam times (e.g. IST, UTC). */
export function formatExamTimezone(timezone = DEFAULT_EXAM_TIMEZONE): string {
  if (TIMEZONE_LABELS[timezone]) return TIMEZONE_LABELS[timezone];
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^GMT[+-]/.test(name)) return name;
  } catch {
    /* fall through */
  }
  return timezone.replace(/^.*\//, '').replace(/_/g, ' ');
}

/** Format an exam timestamp in the exam's configured timezone. */
export function formatExamDateTime(
  iso: string,
  timezone = DEFAULT_EXAM_TIMEZONE,
  options?: { includeTimezone?: boolean },
): string {
  const includeTz = options?.includeTimezone ?? true;
  const tz = timezone || DEFAULT_EXAM_TIMEZONE;
  try {
    const date = new Date(iso);
    const formatted = normalizeTimeText(
      new Intl.DateTimeFormat('en-IN', {
        timeZone: tz,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date),
    );
    if (!includeTz) return formatted;
    return `${formatted} ${formatExamTimezone(tz)}`;
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Format start–end window with timezone shown once at the end. */
export function formatExamTimeRange(
  startIso: string,
  endIso: string,
  timezone = DEFAULT_EXAM_TIMEZONE,
): string {
  const tz = timezone || DEFAULT_EXAM_TIMEZONE;
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const sameDay =
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(start) ===
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(end);

    const timeFmt = new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const dateFmt = new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const tzLabel = formatExamTimezone(tz);
    if (sameDay) {
      return `${dateFmt.format(start)}, ${normalizeTimeText(timeFmt.format(start))} – ${normalizeTimeText(timeFmt.format(end))} ${tzLabel}`;
    }
    return `${formatExamDateTime(startIso, tz, { includeTimezone: false })} – ${formatExamDateTime(endIso, tz)}`;
  } catch {
    return `${new Date(startIso).toLocaleString()} – ${new Date(endIso).toLocaleString()}`;
  }
}

/** Convert UTC ISO to `datetime-local` input value in the exam timezone. */
export function utcIsoToLocalDateTimeInput(iso: string, timezone = DEFAULT_EXAM_TIMEZONE): string {
  try {
    const date = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}
