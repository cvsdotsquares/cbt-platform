/** True once the exam window has opened (UTC start time reached). */
export function hasExamStarted(startTimeIso: string | undefined | null): boolean {
  if (!startTimeIso) return false;
  const startMs = new Date(startTimeIso).getTime();
  if (!Number.isFinite(startMs)) return false;
  return Date.now() >= startMs;
}

export const EXAM_STUDENT_ADD_BLOCKED_MESSAGE =
  'This class test has started. You cannot add students after the start time.';
